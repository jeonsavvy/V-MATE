import { handler as chatHandler } from "./server/chat-handler.js";
import { buildHeaders, isOriginAllowed } from "./server/modules/http-policy.js";
import { buildApiErrorResult } from "./server/modules/http-response.js";
import { mergeChatHandlerContexts, resolveChatHandlerContext } from "./server/modules/chat-handler-context.js";
import { getRequestBodyLimitBytes } from "./server/modules/runtime-config.js";
import { resolveRuntimeChatHandlerContext } from "./server/modules/runtime-chat-context.js";
import { createTraceId } from "./server/modules/trace-id.js";
import { handlePlatformApi } from "./server/platform/api.js";

// Worker는 정적 셸 응답에 runtime env를 주입하고, chat API와 platform API를 분기한다.
const CHAT_API_PATH = "/api/chat";
const SUPABASE_KEEPALIVE_PATHS = [
  "/rest/v1/characters?select=id&limit=1",
  "/rest/v1/worlds?select=id&limit=1",
];
const SUPABASE_KEEPALIVE_TIMEOUT_MS = 10_000;
const SUPABASE_KEEPALIVE_MAX_ATTEMPTS = 2;
const CLIENT_RUNTIME_ENV_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_PUBLIC_SUPABASE_URL",
  "VITE_PUBLIC_SUPABASE_ANON_KEY",
  "VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "VITE_CHAT_API_BASE_URL",
];

const firstNonEmpty = (candidates) => {
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const normalizeUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const isChatApiRequest = (pathname) =>
  pathname === CHAT_API_PATH || pathname === `${CHAT_API_PATH}/`;

const isPlatformApiRequest = (pathname) =>
  pathname.startsWith("/api/") && !isChatApiRequest(pathname);

const createRequestBodyTooLargeError = (maxBodyBytes) => {
  const error = new Error(`Request body exceeds ${maxBodyBytes} bytes.`);
  error.code = "REQUEST_BODY_TOO_LARGE";
  return error;
};

// Wrangler vars를 Node 기반 모듈도 같은 방식으로 읽을 수 있게 process.env에 동기화한다.
const syncWorkerEnvToProcessEnv = (env) => {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    return;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
};

const resolveSupabaseKeepaliveConfig = (env = {}) => {
  const supabaseUrl = normalizeUrl(firstNonEmpty([
    env.SUPABASE_URL,
    env.VITE_SUPABASE_URL,
    env.VITE_PUBLIC_SUPABASE_URL,
  ]));

  const supabasePublicKey = firstNonEmpty([
    env.SUPABASE_PUBLISHABLE_KEY,
    env.SUPABASE_ANON_KEY,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.VITE_SUPABASE_ANON_KEY,
    env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    env.VITE_PUBLIC_SUPABASE_ANON_KEY,
  ]);

  return {
    enabled: Boolean(supabaseUrl && supabasePublicKey),
    keepaliveUrls: supabaseUrl
      ? SUPABASE_KEEPALIVE_PATHS.map((path) => `${supabaseUrl}${path}`)
      : [],
    supabasePublicKey,
  };
};

const createTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
};

const runSupabaseKeepalive = async ({
  env,
  fetchImpl = fetch,
}) => {
  const { enabled, keepaliveUrls, supabasePublicKey } = resolveSupabaseKeepaliveConfig(env);

  if (!enabled) {
    console.warn("[V-MATE] Supabase keepalive skipped: public Supabase config is missing.");
    return { ok: false, skipped: true };
  }

  let lastError = null;

  for (let attempt = 1; attempt <= SUPABASE_KEEPALIVE_MAX_ATTEMPTS; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(SUPABASE_KEEPALIVE_TIMEOUT_MS);

    try {
      const responses = await Promise.all(keepaliveUrls.map(async (keepaliveUrl) => {
        const response = await fetchImpl(keepaliveUrl, {
          method: "GET",
          headers: {
            apikey: supabasePublicKey,
            Accept: "application/json",
            "Cache-Control": "no-store",
            "X-V-MATE-Task": "supabase-keepalive",
          },
          signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(
            `[V-MATE] Supabase keepalive failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`
          );
        }

        return response;
      }));

      console.info("[V-MATE] Supabase keepalive succeeded.", {
        attempt,
        requestCount: responses.length,
        statuses: responses.map((response) => response.status),
      });
      return {
        ok: true,
        skipped: false,
        statuses: responses.map((response) => response.status),
      };
    } catch (error) {
      lastError = error;
      if (attempt === SUPABASE_KEEPALIVE_MAX_ATTEMPTS) {
        break;
      }
    } finally {
      cleanup();
    }
  }

  console.error("[V-MATE] Supabase keepalive failed after retries.", {
    message: lastError?.message || String(lastError),
  });
  throw lastError;
};

// Worker 레벨에서 body 크기를 먼저 제한해 upstream 호출 전에 실패를 확정한다.
const readRequestBodyWithLimit = async (request, maxBodyBytes) => {
  if (request.method === "GET" || request.method === "HEAD") {
    return "";
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw createRequestBodyTooLargeError(maxBodyBytes);
    }
  }

  if (!request.body || typeof request.body.getReader !== "function") {
    const fallbackBody = await request.text();
    const fallbackBytes = new TextEncoder().encode(fallbackBody).length;
    if (fallbackBytes > maxBodyBytes) {
      throw createRequestBodyTooLargeError(maxBodyBytes);
    }
    return fallbackBody;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    byteLength += value.byteLength;
    if (byteLength > maxBodyBytes) {
      if (typeof reader.cancel === "function") {
        try {
          await reader.cancel();
        } catch {
          // noop
        }
      }
      throw createRequestBodyTooLargeError(maxBodyBytes);
    }

    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return body;
};

const toEvent = async (request, maxBodyBytes) => {
  let body = "";
  const url = new URL(request.url);

  body = await readRequestBodyWithLimit(request, maxBodyBytes);

  return {
    httpMethod: request.method,
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      'x-v-mate-request-origin': url.origin,
    },
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body,
  };
};

const mergeResponseHeaders = (fallbackHeaders = {}, resultHeaders = {}) => ({
  ...fallbackHeaders,
  ...(resultHeaders || {}),
});

const toWorkerResponse = (result, fallbackHeaders) =>
  new Response(result?.body ?? "", {
    status: result?.statusCode ?? 500,
    headers: mergeResponseHeaders(fallbackHeaders, result?.headers),
  });

// /api/chat은 공통 CORS/trace 처리 뒤에 chat handler context를 합성해서 전달한다.
const handleChatApi = async (request, env, chatHandlerImpl, chatHandlerContext) => {
  syncWorkerEnvToProcessEnv(env);
  const requestStartedAt = Date.now();
  const requestTraceId = createTraceId();
  const origin = request.headers.get("origin");
  const originAllowed = isOriginAllowed(origin, new URL(request.url).origin, request.headers);
  const headers = {
    ...buildHeaders(originAllowed, origin),
    "X-V-MATE-Trace-Id": requestTraceId,
  };

  if (!originAllowed) {
    return toWorkerResponse(
      buildApiErrorResult({
        statusCode: 403,
        headers,
        startedAtMs: requestStartedAt,
        traceId: requestTraceId,
        error: "Origin is not allowed.",
        errorCode: "ORIGIN_NOT_ALLOWED",
      }),
      headers
    );
  }

  try {
    const event = await toEvent(request, getRequestBodyLimitBytes());
    const configuredContext = await resolveChatHandlerContext({
      chatHandlerContext,
      resolverInput: { request, env },
    });
    const runtimeContext = resolveRuntimeChatHandlerContext({
      env,
      traceId: requestTraceId,
    });
    const handlerContext = mergeChatHandlerContexts(runtimeContext, configuredContext);
    const result = await chatHandlerImpl(event, handlerContext);
    return toWorkerResponse(result, headers);
  } catch (error) {
    if (error?.code === "REQUEST_BODY_TOO_LARGE") {
      return toWorkerResponse(
        buildApiErrorResult({
          statusCode: 413,
          headers,
          startedAtMs: requestStartedAt,
          traceId: requestTraceId,
          error: "Request body is too large.",
          errorCode: "REQUEST_BODY_TOO_LARGE",
        }),
        headers
      );
    }

    return toWorkerResponse(
      buildApiErrorResult({
        statusCode: 500,
        headers,
        startedAtMs: requestStartedAt,
        traceId: requestTraceId,
        error: "Internal server error.",
        errorCode: "INTERNAL_SERVER_ERROR",
        details: process.env.CLOUDFLARE_DEV ? error?.message || String(error) : undefined,
      }),
      headers
    );
  }
};

// /api/* 플랫폼 라우트는 별도 핸들러로 넘겨 CRUD와 플레이 흐름을 분리한다.
const handlePlatformApiRequest = async (request, env) => {
  syncWorkerEnvToProcessEnv(env);
  const requestStartedAt = Date.now();
  const requestTraceId = createTraceId();
  const origin = request.headers.get("origin");
  const originAllowed = isOriginAllowed(origin, new URL(request.url).origin, request.headers);
  const headers = {
    ...buildHeaders(originAllowed, origin),
    "X-V-MATE-Trace-Id": requestTraceId,
  };

  if (!originAllowed) {
    return toWorkerResponse(
      buildApiErrorResult({
        statusCode: 403,
        headers,
        startedAtMs: requestStartedAt,
        traceId: requestTraceId,
        error: "Origin is not allowed.",
        errorCode: "ORIGIN_NOT_ALLOWED",
      }),
      headers
    );
  }

  try {
    const event = await toEvent(request, getRequestBodyLimitBytes());
    const result = await handlePlatformApi({
      event,
      headers,
      startedAtMs: requestStartedAt,
      traceId: requestTraceId,
    });
    return toWorkerResponse(result, headers);
  } catch (error) {
    if (error?.code === "REQUEST_BODY_TOO_LARGE") {
      return toWorkerResponse(
        buildApiErrorResult({
          statusCode: 413,
          headers,
          startedAtMs: requestStartedAt,
          traceId: requestTraceId,
          error: "Request body is too large.",
          errorCode: "REQUEST_BODY_TOO_LARGE",
        }),
        headers
      );
    }

    return toWorkerResponse(
      buildApiErrorResult({
        statusCode: 500,
        headers,
        startedAtMs: requestStartedAt,
        traceId: requestTraceId,
        error: "Internal server error.",
        errorCode: "INTERNAL_SERVER_ERROR",
        details: process.env.CLOUDFLARE_DEV ? error?.message || String(error) : undefined,
      }),
      headers
    );
  }
};

const isHtmlRequest = (request) => {
  if (request.method !== "GET") return false;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
};

// 클라이언트가 알아야 하는 공개 환경 변수만 HTML에 주입한다.
const buildClientRuntimeEnv = (env) => {
  const runtimeEnv = {};

  for (const key of CLIENT_RUNTIME_ENV_KEYS) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) {
      runtimeEnv[key] = value;
    }
  }

  return runtimeEnv;
};

const injectRuntimeEnvIntoHtml = async (response, env) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const html = await response.text();
  const runtimeEnv = buildClientRuntimeEnv(env);
  const serializedRuntimeEnv = JSON.stringify(runtimeEnv).replace(/</g, "\\u003c");
  const runtimeScript = `<script id="v-mate-runtime-env">window.__V_MATE_RUNTIME_ENV__=${serializedRuntimeEnv};</script>`;

  const body = html.includes("</head>")
    ? html.replace("</head>", `${runtimeScript}</head>`)
    : `${runtimeScript}${html}`;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const serveStaticAsset = async (request, env) => {
  let assetResponse = await env.ASSETS.fetch(request);

  if (assetResponse.status === 404 && isHtmlRequest(request)) {
    const url = new URL(request.url);
    url.pathname = "/index.html";
    assetResponse = await env.ASSETS.fetch(new Request(url.toString(), request));
  }

  return injectRuntimeEnvIntoHtml(assetResponse, env);
};

export const createWorker = ({
  chatHandlerImpl = chatHandler,
  chatHandlerContext = {},
  keepaliveFetchImpl = fetch,
} = {}) => ({
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isChatApiRequest(url.pathname)) {
      return handleChatApi(request, env, chatHandlerImpl, chatHandlerContext);
    }

    if (isPlatformApiRequest(url.pathname)) {
      return handlePlatformApiRequest(request, env);
    }

    return serveStaticAsset(request, env);
  },

  async scheduled(_controller, env, ctx) {
    syncWorkerEnvToProcessEnv(env);
    const task = runSupabaseKeepalive({
      env,
      fetchImpl: keepaliveFetchImpl,
    });

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(task);
      return;
    }

    return task;
  },
});

const worker = createWorker();

export default worker;

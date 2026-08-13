import { handler as chatHandler } from "./server/chat-handler.js";
import { executeApiIngress } from "./server/modules/api-ingress.js";
import { CORS_ALLOWED_METHODS } from "./server/modules/http-policy.js";
import { mergeChatHandlerContexts, resolveChatHandlerContext } from "./server/modules/chat-handler-context.js";
import { createRuntimeConfig } from "./server/modules/runtime-config.js";
import { resolveRuntimeEnvironmentChatContext } from "./server/modules/runtime-environment-chat-context.js";
import { readRuntimeEnvironmentString } from "./server/modules/runtime-environment.js";
import { handlePlatformApi } from "./server/platform/api.js";
import {
  reconcileAccountStorageCleanupFences,
  reconcileExpiredChatReservations,
  reconcileStorageDeletionOutbox,
} from "./server/platform/supabase-platform-repository.js";

// Worker는 정적 셸 응답에 runtime env를 주입하고, chat API와 platform API를 분기한다.
const CHAT_API_PATH = "/api/chat";
const SUPABASE_KEEPALIVE_BASE_PATHS = [
  "/rest/v1/characters",
  "/rest/v1/worlds",
];
const SUPABASE_KEEPALIVE_TIMEOUT_MS = 10_000;
const SUPABASE_KEEPALIVE_MAX_ATTEMPTS = 3;
const SUPABASE_KEEPALIVE_ROTATING_OFFSET_SPREAD = 3;
const SUPABASE_KEEPALIVE_ROTATING_OFFSET_MIN = 1;
const SUPABASE_KEEPALIVE_ROTATION_WINDOW_MS = 15 * 60 * 1000;
const CLIENT_RUNTIME_ENV_FIELDS = {
  supabaseUrl: ["VITE_SUPABASE_URL", "VITE_PUBLIC_SUPABASE_URL"],
  supabasePublicKey: [
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ],
  chatApiBaseUrl: ["VITE_CHAT_API_BASE_URL"],
};

const SECURITY_RESPONSE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

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

const applySecurityHeaders = (headers = new Headers()) => {
  const nextHeaders = new Headers(headers);
  for (const [key, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (!nextHeaders.has(key)) {
      nextHeaders.set(key, value);
    }
  }
  return nextHeaders;
};

const withSecurityHeaders = (response) => {
  const headers = applySecurityHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const buildSupabaseKeepaliveUrls = ({ supabaseUrl, scheduledTime = Date.now() }) => {
  if (!supabaseUrl) {
    return [];
  }

  const rotationBucket = Math.max(
    0,
    Math.floor(Number(scheduledTime || 0) / SUPABASE_KEEPALIVE_ROTATION_WINDOW_MS),
  );
  const rotatingOffset = SUPABASE_KEEPALIVE_ROTATING_OFFSET_MIN
    + (rotationBucket % SUPABASE_KEEPALIVE_ROTATING_OFFSET_SPREAD);
  const probeQueries = [
    "select=id&order=updated_at.desc&limit=1",
    `select=id&order=updated_at.desc&limit=1&offset=${rotatingOffset}`,
  ];

  return SUPABASE_KEEPALIVE_BASE_PATHS.flatMap((path) =>
    probeQueries.map((query) => `${supabaseUrl}${path}?${query}`),
  );
};

const isChatApiRequest = (pathname) =>
  pathname === CHAT_API_PATH || pathname === `${CHAT_API_PATH}/`;

const isPlatformApiRequest = (pathname) =>
  pathname.startsWith("/api/") && !isChatApiRequest(pathname);

const createRequestBodyTooLargeError = (maxBodyBytes) => {
  const error = new Error(`Request body exceeds ${maxBodyBytes} bytes.`);
  error.code = "REQUEST_BODY_TOO_LARGE";
  return error;
};

const resolveSupabaseKeepaliveConfig = ({ env = {}, scheduledTime } = {}) => {
  const supabaseUrl = normalizeUrl(firstNonEmpty([
    readRuntimeEnvironmentString(env, "SUPABASE_URL"),
    readRuntimeEnvironmentString(env, "VITE_SUPABASE_URL"),
    readRuntimeEnvironmentString(env, "VITE_PUBLIC_SUPABASE_URL"),
  ]));

  const supabasePublicKey = firstNonEmpty([
    readRuntimeEnvironmentString(env, "SUPABASE_PUBLISHABLE_KEY"),
    readRuntimeEnvironmentString(env, "SUPABASE_ANON_KEY"),
    readRuntimeEnvironmentString(env, "VITE_SUPABASE_PUBLISHABLE_KEY"),
    readRuntimeEnvironmentString(env, "VITE_SUPABASE_ANON_KEY"),
    readRuntimeEnvironmentString(env, "VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    readRuntimeEnvironmentString(env, "VITE_PUBLIC_SUPABASE_ANON_KEY"),
  ]);

  return {
    enabled: Boolean(supabaseUrl && supabasePublicKey),
    keepaliveUrls: buildSupabaseKeepaliveUrls({ supabaseUrl, scheduledTime }),
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
  scheduledTime,
  fetchImpl = fetch,
}) => {
  const { enabled, keepaliveUrls, supabasePublicKey } = resolveSupabaseKeepaliveConfig({
    env,
    scheduledTime,
  });

  if (!enabled) {
    console.warn("[V-MATE] Database keepalive skipped: public configuration is missing.");
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
          throw new Error(
            `[V-MATE] Supabase keepalive failed (${response.status})`
          );
        }

        return response;
      }));

      console.info("[V-MATE] Database keepalive succeeded.", {
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

  console.error("[V-MATE] Database keepalive failed after retries.");
  throw lastError;
};

const runScheduledMaintenance = async ({
  env,
  scheduledTime,
  keepaliveFetchImpl,
  reconcileAccountStorageCleanupFencesImpl,
  reconcileExpiredChatReservationsImpl,
  reconcileStorageDeletionOutboxImpl,
}) => {
  const results = await Promise.allSettled([
    runSupabaseKeepalive({
      env,
      scheduledTime,
      fetchImpl: keepaliveFetchImpl,
    }),
    reconcileExpiredChatReservationsImpl({ limit: 100, runtimeEnvironment: env }),
    reconcileStorageDeletionOutboxImpl({ limit: 20, runtimeEnvironment: env }),
    reconcileAccountStorageCleanupFencesImpl({ limit: 20, runtimeEnvironment: env }),
  ]);

  const failedTaskCount = results.filter((result) => result.status === "rejected").length;
  if (failedTaskCount > 0) {
    console.error("[V-MATE] Scheduled maintenance failed.", { failedTaskCount });
    throw new Error("Scheduled maintenance failed.");
  }

  return {
    keepalive: results[0].value,
    chatReservationReconciliation: results[1].value,
    storageDeletionReconciliation: results[2].value,
    accountStorageCleanupReconciliation: results[3].value,
  };
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

const toEvent = async (request, maxBodyBytes, requestContext) => {
  let body = "";
  const url = new URL(request.url);

  body = await readRequestBodyWithLimit(request, maxBodyBytes);

  return {
    httpMethod: request.method,
    requestContext: {
      trustedProxy: true,
      traceId: requestContext.traceId,
    },
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
    headers: applySecurityHeaders(mergeResponseHeaders(fallbackHeaders, result?.headers)),
  });

// /api/chat은 공통 CORS/trace 처리 뒤에 chat handler context를 합성해서 전달한다.
const handleChatApi = async (
  request,
  runtimeConfig,
  executionContext,
  chatHandlerImpl,
  chatHandlerContext,
) => {
  const origin = request.headers.get("origin");
  const result = await executeApiIngress({
    origin,
    requestOrigin: new URL(request.url).origin,
    requestHeaders: request.headers,
    allowedMethods: CORS_ALLOWED_METHODS.chat,
    runtimeConfig,
    executionContext,
    createEvent: (requestContext) => toEvent(
      request,
      runtimeConfig.requestBodyLimitBytes,
      requestContext,
    ),
    handle: async ({ event, requestContext }) => {
      const configuredContext = await resolveChatHandlerContext({
        chatHandlerContext,
        resolverInput: {
          request,
          env: runtimeConfig.environment,
          requestContext,
          runtimeConfig,
        },
      });
      const runtimeContext = resolveRuntimeEnvironmentChatContext({
        runtimeConfig,
        traceId: requestContext.traceId,
      });
      const handlerContext = Object.freeze({
        ...mergeChatHandlerContexts(runtimeContext, configuredContext),
        traceId: requestContext.traceId,
        requestContext,
        runtimeConfig,
        runtimeEnvironment: runtimeConfig.environment,
      });
      return chatHandlerImpl(event, handlerContext);
    },
  });

  return toWorkerResponse(result, result?.headers);
};

// /api/* 플랫폼 라우트는 별도 핸들러로 넘겨 CRUD와 플레이 흐름을 분리한다.
const handlePlatformApiRequest = async (request, runtimeConfig, executionContext) => {
  const origin = request.headers.get("origin");
  const result = await executeApiIngress({
    origin,
    requestOrigin: new URL(request.url).origin,
    requestHeaders: request.headers,
    allowedMethods: CORS_ALLOWED_METHODS.platform,
    runtimeConfig,
    executionContext,
    createEvent: (requestContext) => toEvent(
      request,
      runtimeConfig.requestBodyLimitBytes,
      requestContext,
    ),
    handle: ({ event, requestContext }) => handlePlatformApi({
      event,
      headers: requestContext.responseHeaders,
      startedAtMs: requestContext.startedAtMs,
      traceId: requestContext.traceId,
      requestContext,
      runtimeConfig,
      runtimeEnvironment: runtimeConfig.environment,
    }),
  });

  return toWorkerResponse(result, result?.headers);
};

const isHtmlRequest = (request) => {
  if (request.method !== "GET") return false;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
};

// 기존 공개 binding을 읽되, 브라우저에는 안정된 공개 필드명만 전달한다.
const buildClientRuntimeEnv = (env) => {
  const runtimeEnv = {};

  for (const [field, keys] of Object.entries(CLIENT_RUNTIME_ENV_FIELDS)) {
    const value = firstNonEmpty(keys.map((key) => readRuntimeEnvironmentString(env, key)));
    if (value) {
      runtimeEnv[field] = value;
    }
  }

  return runtimeEnv;
};

const injectRuntimeEnvIntoHtml = async (response, env) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return withSecurityHeaders(response);
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
  for (const [key, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

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
  reconcileAccountStorageCleanupFencesImpl = reconcileAccountStorageCleanupFences,
  reconcileExpiredChatReservationsImpl = reconcileExpiredChatReservations,
  reconcileStorageDeletionOutboxImpl = reconcileStorageDeletionOutbox,
} = {}) => ({
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);

    if (isChatApiRequest(url.pathname)) {
      const runtimeConfig = createRuntimeConfig(env);
      return handleChatApi(
        request,
        runtimeConfig,
        executionContext,
        chatHandlerImpl,
        chatHandlerContext,
      );
    }

    if (isPlatformApiRequest(url.pathname)) {
      const runtimeConfig = createRuntimeConfig(env);
      return handlePlatformApiRequest(request, runtimeConfig, executionContext);
    }

    return serveStaticAsset(request, env);
  },

  async scheduled(_controller, env, ctx) {
    const task = runScheduledMaintenance({
      env,
      scheduledTime: _controller?.scheduledTime,
      keepaliveFetchImpl,
      reconcileAccountStorageCleanupFencesImpl,
      reconcileExpiredChatReservationsImpl,
      reconcileStorageDeletionOutboxImpl,
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

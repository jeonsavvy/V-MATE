# Agent-readable public surface

## Goal

- Make the public V-MATE homepage understandable without JavaScript.
- Return a real, recoverable `404` for paths outside the application route contract.
- Offer the homepage as Markdown without changing the browser response.
- Publish only factual discovery metadata already supported by the product and repository.

## Confirmed facts

- The 2026-08-22 Is Agentic baseline for `https://v-mate.satinode.com` scored `44/100`.
- The live homepage raw HTML contains no heading or product body text.
- A nonexistent path returns the SPA shell with `200 OK`.
- `Accept: text/markdown` currently returns HTML without `Vary: Accept`.
- The public site has no sitemap, `llms.txt`, JSON-LD, or Open Graph image metadata.
- V-MATE has first-party application APIs, but no repository contract defines them as a public agent or third-party integration surface.

## Non-goals for the implementation change

- Coupling deployment or an external rescan to the implementation commit. Release remains an operator-authorized workflow step.
- Publishing an incomplete OpenAPI document, developer portal, CLI, MCP server, or OAuth surface.
- Inventing company address, pricing, ratings, support guarantees, or third-party integration promises.
- Changing authentication, storage, model calls, API authorization, or database behavior.
- Returning `404` for recognized SPA routes or for a missing dynamic entity before its application data lookup runs.

## Affected contract

### Document responses

- `/` and `/index.html` return the Vite application HTML for normal browser requests.
- The initial HTML contains one `h1`, ordered supporting headings, at least 500 characters of factual Korean product text, and links to the canonical homepage and privacy page.
- `Accept: text/markdown` on `/` or `/index.html` returns the public `llms.txt` representation with `Content-Type: text/markdown; charset=utf-8`.
- Both HTML and Markdown variants include `Vary: Accept, Accept-Encoding`.

### SPA routing and missing paths

- Recognized routes are `/`, `/index.html`, and the exact static or parameterized paths represented by `src/lib/platform/routes.tsx`.
- A recognized route whose asset lookup returns `404` falls back to `/index.html` and keeps the existing runtime-environment injection.
- An unrecognized document path returns `404` with a short recovery response linking to `/sitemap.xml`, `/llms.txt`, and `/`.
- Missing file-like assets keep the asset binding's `404` response.
- Cloudflare HTML rewriting and asset fallback are set to `none`; the Worker owns canonical SPA routing and the recognized-route fallback.

```text
request
  -> chat or platform API? use the existing API handler
  -> homepage asks for Markdown? stream /llms.txt with negotiated headers
  -> fetch matching static asset
  -> asset exists? return it
  -> recognized SPA document route? fetch /index.html and inject runtime env
  -> missing document route? return recoverable 404
  -> otherwise preserve the asset 404
```

### Discovery files and metadata

- `/sitemap.xml` lists only stable public pages: `/` and `/privacy`.
- `robots.txt` permits crawling and points to the sitemap.
- `/llms.txt` describes the product, appropriate use, public pages, and interaction limits without advertising an integration API.
- Homepage JSON-LD uses `WebSite` with the verified name, URL, description, and Korean language.
- Open Graph and Twitter image metadata reuse an existing public V-MATE starter image.

## Consequential assumptions

- Cloudflare Workers Static Assets with `html_handling: "none"` and `not_found_handling: "none"` sends exact asset misses to the Worker without adding trailing-slash redirects; the Worker can then distinguish recognized SPA paths from unknown paths.
- React `createRoot` replaces the static `#root` fallback after JavaScript loads. The no-JavaScript shell remains the delivery surface for crawlers and script failures.
- The existing starter image is appropriate as a generic V-MATE share preview; rendered inspection must confirm its crop and identity.

## Implementation rollback

- Revert the public-surface files and restore `not_found_handling: "single-page-application"`.
- The implementation does not change a database, secret, or Cloudflare variable. A later release uses the repository's evidence-bound Worker rollback workflow.

## Proving checks

- A focused Worker test proves recognized deep links still return the application shell and unknown document paths return `404`.
- A focused Worker test proves HTML/Markdown negotiation and `Vary` headers.
- A public-surface contract test proves the raw homepage structure, JSON-LD, sitemap, robots declaration, and `llms.txt` guidance.
- `npm run verify` passes.
- A local Worker session returns the expected status, content type, headings, and recovery links for `/`, `/privacy`, `/sitemap.xml`, `/llms.txt`, and an unknown path.
- The rendered homepage passes visual inspection with JavaScript enabled; the static shell remains readable with JavaScript unavailable. Accessibility semantics, focus, and heading order are checked separately from pixels.

# Alloy — MVP Architecture Plan

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Build the MVP of **Alloy**, a Rust-powered desktop HTTP API client, delivering the core request/response loop: a user can compose an HTTP request (method, URL, headers, body), send it through a performant Rust backend, and inspect the full response (status, headers, body, timing, size). This MVP establishes the foundational architecture — TauRPC IPC layer, Zustand state management, Reqwest HTTP engine — upon which all future features (collections, environments, history, .http file persistence) will be built.

### 1.2 — Approach Summary

**Architecture:** Tauri v2 desktop app with a React 19 frontend communicating with a Rust backend via TauRPC (type-safe IPC). The frontend is a single-page panel-based layout (no router) — a request builder on top and a response viewer on the bottom, similar to Postman/Insomnia.

**Key Technology Choices:**
- **IPC:** TauRPC generates TypeScript bindings from Rust trait definitions, giving end-to-end type safety with zero manual serialization code.
- **HTTP Engine:** Reqwest (built on hyper) provides a high-level HTTP client with TLS, redirects, multipart, cookies, and connection pooling out of the box.
- **State Management:** Zustand — single centralized store for all app state (active request, response, UI state).
- **Code Editor:** CodeMirror 6 (via `@uiw/react-codemirror`) for JSON/XML/text body editing with syntax highlighting.
- **UI Components:** shadcn (already scaffolded) with Radix primitives for dropdowns, tabs, inputs.

**Data Flow:**
```
User Input → React Components → Zustand Store → TauRPC Client
    → [IPC Bridge] →
TauRPC Rust Handler → Reqwest → Target HTTP Server
    → [Response back through same chain] →
Response Viewer UI
```

### 1.3 — Decisions Log

- **Decision:** Use Reqwest instead of raw Hyper for the HTTP client.
  - **Alternatives considered:** Hyper (direct), Hyper + custom wrapper.
  - **Rationale:** Hyper requires ~5 companion crates and manual implementation of redirects, cookies, multipart, and TLS. Reqwest wraps hyper with all of these built-in. For an API client that needs to handle every HTTP edge case, the higher-level abstraction saves weeks of work with negligible performance trade-off.

- **Decision:** Use Zustand as the sole state management library (drop Jotai).
  - **Alternatives considered:** Jotai only, Jotai + Zustand hybrid.
  - **Rationale:** A single state library reduces cognitive overhead. Zustand's centralized model maps cleanly to the app's data flow (one active request, one response, UI state). Atomic state adds complexity without clear benefit at MVP scale.

- **Decision:** No client-side routing (drop TanStack Router).
  - **Alternatives considered:** TanStack Router with 2-3 routes.
  - **Rationale:** Alloy is a desktop tool with a fixed panel layout, not a page-based web app. Navigation is handled by panel visibility state in Zustand, not URL routes.

- **Decision:** CodeMirror 6 for code editing.
  - **Alternatives considered:** Monaco Editor, plain textarea.
  - **Rationale:** CodeMirror 6 is significantly lighter than Monaco (~50KB vs ~5MB), loads instantly, and provides sufficient functionality (syntax highlighting, folding, search) for editing request/response bodies.

- **Decision:** MVP scope is the core request/response loop only.
  - **Alternatives considered:** Full feature plan, phased plan.
  - **Rationale:** Establishing the architecture cleanly with one vertical slice (send request → view response) validates all integration points (TauRPC, Reqwest, Zustand, CodeMirror) before adding complexity.

- **Decision:** TauRPC for the IPC layer instead of raw Tauri commands.
  - **Alternatives considered:** `#[tauri::command]` with manual serde types.
  - **Rationale:** TauRPC auto-generates TypeScript types from Rust traits, eliminating type drift between frontend and backend. The router pattern also provides clean API namespacing for future feature expansion.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- The app targets desktop only (no mobile/iOS/Android for now).
- The MVP does not persist any data — requests are ephemeral (typed in UI, sent, response viewed, lost on close). File persistence (.http format) and SQLite history are post-MVP.
- Response bodies are rendered as text (UTF-8 with lossy conversion). Binary response handling is post-MVP.
- No authentication presets (Bearer, Basic, OAuth) in the UI — users manually set Authorization headers. Auth UI is post-MVP.
- The app uses a single window. Multi-window/multi-tab support is post-MVP.
- Self-signed certificate / SSL skip is a simple toggle, not in MVP. Reqwest defaults to validating certs.

**Open Questions (non-blocking for MVP):**
- Should the app eventually support WebSocket/gRPC, or is it strictly HTTP REST?
- Should response bodies be streamed to the UI for very large responses, or is a max-size cutoff acceptable?
- For post-MVP: should the SQLite history DB store full response bodies or just metadata?

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TauRPC specta version lock (`=2.0.0-rc.22`) conflicts with other deps | Medium | High | Pin specta version early; if conflict arises, fall back to raw `#[tauri::command]` with shared types |
| CodeMirror 6 bundle size impacts startup time | Low | Low | CodeMirror 6 is ~50KB gzipped; lazy-load extensions if needed |
| Reqwest blocks Tauri's async runtime on large responses | Low | Medium | Reqwest is fully async on Tokio; use `.bytes()` with size limits; stream very large bodies |
| TauRPC TypeScript bindings not generated on first build | Medium | Low | Document the required build sequence (`cargo build` before frontend dev); bindings.ts must exist before TS compilation |
| Large JSON responses crash the CodeMirror editor | Medium | Medium | Truncate display at 1MB; show "Response too large" with option to save to file |
| User sends request to localhost/internal network (SSRF-like) | Low | Low | Desktop app — this is expected behavior, not a security concern |

### 1.6 — Step Sequence Overview

```
1. Backend Infrastructure     — Rust dependencies, module structure, TauRPC router skeleton
2. Frontend Infrastructure    — npm dependencies, app shell layout, Zustand store skeleton
3. IPC Contract Definition    — TauRPC procedures and shared types for HTTP request/response
4. Rust HTTP Service          — Reqwest-based request executor with timing and error handling
5. Request Builder UI         — Method selector, URL bar, Send button, query params sync
6. Request Detail Tabs        — Headers editor, Body editor (CodeMirror), body type selector
7. Response Viewer UI         — Status bar, response body (CodeMirror), response headers
8. End-to-End Wiring & Polish — Connect all layers, loading states, error display, UX refinements
```

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Backend Infrastructure

**Objective:** Set up all Rust dependencies, create the backend module structure, and scaffold the TauRPC router so the app compiles and TauRPC generates its TypeScript bindings.

**Context:**
- The current `src-tauri/` has a minimal Tauri v2 scaffold with a single `greet` command.
- We need to replace the `greet` command with a TauRPC-based router.
- TauRPC generates `bindings.ts` at compile time — this file must exist before the frontend can reference it.

**Scope:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/http.rs`
- Create: `src-tauri/src/http/mod.rs`
- Create: `src-tauri/src/http/client.rs`
- Create: `src-tauri/src/http/types.rs`
- Create: `src-tauri/src/error.rs`

**Sub-tasks:**

1. **Update `src-tauri/Cargo.toml` dependencies.** Add the following dependencies:
   - `taurpc = "0.7"` — IPC layer
   - `specta = { version = "=2.0.0-rc.22", features = ["derive"] }` — type export (pinned version required by TauRPC)
   - `tokio = { version = "1", features = ["full"] }` — async runtime
   - `reqwest = { version = "0.12", features = ["json", "multipart", "cookies", "rustls-tls"] }` — HTTP client (use rustls for TLS, not native-tls, to avoid OpenSSL dependency)
   - `thiserror = "2"` — error types
   - Keep existing: `tauri`, `tauri-plugin-opener`, `serde`, `serde_json`

2. **Create the module directory structure.** Create directories:
   - `src-tauri/src/commands/`
   - `src-tauri/src/http/`

3. **Create `src-tauri/src/error.rs`.** Define a top-level `AppError` enum using `thiserror::Error` and `specta::Type`. It must implement `serde::Serialize` (required by TauRPC for Result return types). Include variants:
   - `RequestError(String)` — wraps reqwest errors
   - `InvalidUrl(String)` — URL parsing failures
   - `Timeout` — request timeout
   - `NetworkError(String)` — connection failures
   Implement `From<reqwest::Error>` to auto-convert reqwest errors into `AppError`.

4. **Create `src-tauri/src/http/types.rs`.** Define the shared IPC types using `#[taurpc::ipc_type]`:
   - `KeyValue { key: String, value: String, enabled: bool }` — used for headers, query params, form fields
   - `RequestBody` enum: `None`, `Json(String)`, `FormUrlEncoded(Vec<KeyValue>)`, `Raw { content: String, content_type: String }`
   - `HttpRequestData { method: String, url: String, headers: Vec<KeyValue>, query_params: Vec<KeyValue>, body: RequestBody }` — the full request payload sent from frontend
   - `HttpResponseData { status: u16, status_text: String, headers: Vec<KeyValue>, body: String, size_bytes: u64, time_ms: u64 }` — the response payload sent back to frontend

5. **Create `src-tauri/src/http/client.rs`.** For now, just define a stub `pub async fn execute_request(request: HttpRequestData) -> Result<HttpResponseData, AppError>` function that returns a hardcoded 200 response. The real implementation comes in Step 4.

6. **Create `src-tauri/src/http/mod.rs`.** Re-export `pub mod client;` and `pub mod types;`.

7. **Create `src-tauri/src/commands/http.rs`.** Define the TauRPC procedures trait:
   ```
   #[taurpc::procedures(export_to = "../src/bindings.ts")]
   trait Api {
       async fn send_request(request: HttpRequestData) -> Result<HttpResponseData, AppError>;
   }
   ```
   Create a `#[derive(Clone)] struct ApiImpl;` and implement the trait with `#[taurpc::resolvers]`. The `send_request` resolver should call `http::client::execute_request`.

8. **Create `src-tauri/src/commands/mod.rs`.** Re-export `pub mod http;`.

9. **Update `src-tauri/src/lib.rs`.** Replace the existing `greet` command with the TauRPC router:
   - Add `mod commands; mod http; mod error;`
   - In the `run()` function, create a `taurpc::Router` and merge the `ApiImpl` handler
   - Replace `.invoke_handler(tauri::generate_handler![greet])` with `.invoke_handler(router.into_handler())`
   - Remove the `greet` function entirely

10. **Update `src-tauri/src/main.rs`.** This file should remain as-is (it just calls `alloy_lib::run()`). Verify it compiles.

**Edge Cases & Gotchas:**
- TauRPC requires the exact specta version `=2.0.0-rc.22`. Using a caret range (`^2.0.0-rc.22`) will break.
- The `export_to` path in `#[taurpc::procedures]` is relative to `src-tauri/`, so `"../src/bindings.ts"` writes to the frontend `src/` directory.
- The `bindings.ts` file is auto-generated and should be added to `.gitignore` (or at least documented as generated).
- `taurpc::ipc_type` automatically derives `Serialize`, `Deserialize`, `specta::Type`, and `Clone` — do NOT manually derive these or you'll get duplicate trait errors.
- The `AppError` type must implement `serde::Serialize` manually (not via derive) because `reqwest::Error` and other inner types don't implement Serialize. Use `serializer.serialize_str(self.to_string().as_ref())`.

**Verification:**
- Run `cargo build` from `src-tauri/`. It should compile without errors.
- Verify that `src/bindings.ts` was generated (it's created when the Rust binary runs or when `tauri dev` starts).
- If `bindings.ts` is not generated immediately on `cargo build` alone (it requires the app to run), create a minimal placeholder `src/bindings.ts` with a comment `// Generated by TauRPC — run `bun tauri dev` to regenerate` so the frontend can compile.

**Depends On:** None
**Blocks:** Step 3, Step 4

---

### Step 2: Frontend Infrastructure

**Objective:** Install all frontend dependencies, remove unused scaffolding, create the app shell layout with a resizable split-pane design, and set up the Zustand store skeleton.

**Context:**
- The current frontend has React 19, Tailwind 4, shadcn, React Query, and a minimal `main.tsx`.
- We need to add: Zustand, CodeMirror, TauRPC client package.
- We need to remove: any traces of TanStack Router (the `.tanstack/` directory).
- The app layout is a single-page desktop UI: request builder on top, response viewer on bottom, with a resizable divider.

**Scope:**
- Modify: `package.json` (add dependencies)
- Modify: `src/main.tsx` (add app shell)
- Modify: `index.html` (update title)
- Create: `src/App.tsx` (main layout component)
- Create: `src/stores/request-store.ts` (Zustand store)
- Create: `src/components/request/RequestPanel.tsx` (placeholder)
- Create: `src/components/response/ResponsePanel.tsx` (placeholder)
- Delete: `.tanstack/` directory

**Sub-tasks:**

1. **Install npm dependencies.** Run the following:
   - `bun add zustand` — state management
   - `bun add @uiw/react-codemirror @codemirror/lang-json @codemirror/lang-xml @codemirror/lang-html @codemirror/themes` — CodeMirror 6 with language support
   - `bun add taurpc` — TauRPC frontend client
   - `bun add react-resizable-panels` — resizable split panes (lightweight, well-maintained, works great for IDE-like layouts)

2. **Remove `.tanstack/` directory.** Delete the entire `.tanstack/` directory from the project root.

3. **Update `index.html`.** Change the `<title>` from "Tauri + React + Typescript" to "Alloy". Optionally update the favicon link.

4. **Create `src/stores/request-store.ts`.** Define a Zustand store with the following shape (this is the skeleton — types will come from `bindings.ts` once Step 1 generates it, but for now use local interfaces that match the planned types):

   The store should contain:
   - `method: string` (default: `"GET"`)
   - `url: string` (default: `""`)
   - `headers: KeyValue[]` (default: one empty row)
   - `queryParams: KeyValue[]` (default: empty)
   - `bodyType: "none" | "json" | "form-urlencoded" | "raw"` (default: `"none"`)
   - `bodyContent: string` (default: `""`) — for JSON and raw body types
   - `bodyFormData: KeyValue[]` (default: empty) — for form-urlencoded
   - `rawContentType: string` (default: `"text/plain"`) — for raw body type
   - `response: HttpResponseData | null` (default: `null`)
   - `isLoading: boolean` (default: `false`)
   - `error: string | null` (default: `null`)
   - `activeRequestTab: "params" | "headers" | "body"` (default: `"params"`)
   - `activeResponseTab: "body" | "headers"` (default: `"body"`)

   Actions:
   - `setMethod(method: string)`
   - `setUrl(url: string)`
   - `setHeaders(headers: KeyValue[])`
   - `setQueryParams(params: KeyValue[])`
   - `setBodyType(type: string)`
   - `setBodyContent(content: string)`
   - `setBodyFormData(data: KeyValue[])`
   - `setResponse(response: HttpResponseData | null)`
   - `setLoading(loading: boolean)`
   - `setError(error: string | null)`
   - `setActiveRequestTab(tab: string)`
   - `setActiveResponseTab(tab: string)`
   - `syncQueryParamsToUrl()` — parses `queryParams` array and updates the URL's query string
   - `syncUrlToQueryParams()` — parses the URL's query string and updates the `queryParams` array

   Define a local `KeyValue` interface: `{ key: string; value: string; enabled: boolean; id: string }`. The `id` field is a client-side UUID for React list keys (not sent to backend).

5. **Create `src/App.tsx`.** This is the main app layout:
   - Import `PanelGroup`, `Panel`, `PanelResizeHandle` from `react-resizable-panels`
   - Render a vertical `PanelGroup` with:
     - Top `Panel` (minSize ~30%, defaultSize 50%): renders `<RequestPanel />`
     - `PanelResizeHandle`: a thin horizontal divider bar (styled with Tailwind — `h-1 bg-border hover:bg-primary/20 transition-colors`)
     - Bottom `Panel` (minSize ~20%, defaultSize 50%): renders `<ResponsePanel />`
   - The outermost div should be `h-screen w-screen flex flex-col overflow-hidden` with `bg-background text-foreground`

6. **Create `src/components/request/RequestPanel.tsx`.** A placeholder component that renders a div with text "Request Builder" and applies basic layout classes (`flex flex-col h-full overflow-hidden`).

7. **Create `src/components/response/ResponsePanel.tsx`.** A placeholder component that renders a div with text "Response Viewer" and applies basic layout classes.

8. **Update `src/main.tsx`.** Replace the current content:
   - Keep React Query provider (useful for future features and for wrapping TauRPC calls)
   - Import and render `<App />` inside the providers
   - Import `src/index.css`

**Edge Cases & Gotchas:**
- `react-resizable-panels` needs its CSS for the resize handle cursor. The handle component should have `cursor-row-resize` applied.
- The Zustand store should NOT import from `bindings.ts` yet — that file may not exist until Step 1's output is available. Use local type definitions that will be swapped to the generated types in Step 3.
- Ensure the `id` field on `KeyValue` is generated client-side (use `crypto.randomUUID()`) and stripped before sending to the backend.
- The `syncQueryParamsToUrl` and `syncUrlToQueryParams` functions must handle malformed URLs gracefully (try/catch around `new URL()`).

**Verification:**
- Run `bun run dev` (standalone Vite dev server, not `tauri dev`). The app should show a split-pane layout with "Request Builder" on top and "Response Viewer" on bottom.
- The resize handle between the panels should be draggable.
- No console errors.

**Depends On:** None (can be done in parallel with Step 1)
**Blocks:** Step 5, Step 6, Step 7

---

### Step 3: IPC Contract Definition

**Objective:** Finalize the TauRPC type definitions and ensure the generated `bindings.ts` is integrated into the frontend, replacing placeholder types in the Zustand store.

**Context:**
- Step 1 created the Rust-side TauRPC procedures and types.
- Step 2 created the Zustand store with local type placeholders.
- Now we need to run `bun tauri dev` (or `cargo build` from src-tauri) to generate `bindings.ts`, then update the frontend to import types from it.

**Scope:**
- Modify: `src/stores/request-store.ts` (import types from bindings)
- Verify: `src/bindings.ts` (generated file)
- Modify: `.gitignore` (add bindings.ts note or keep it tracked)
- Create: `src/lib/api.ts` (thin wrapper around TauRPC proxy)

**Sub-tasks:**

1. **Trigger TauRPC binding generation.** Run `bun tauri dev` and let the Rust side compile. This will generate `src/bindings.ts`. Stop the dev server once it's running. Alternatively, run `cargo build` from `src-tauri/` and then run the resulting binary briefly.

2. **Inspect the generated `src/bindings.ts`.** Verify it contains:
   - Exported types: `KeyValue`, `RequestBody`, `HttpRequestData`, `HttpResponseData`, `AppError` (or however TauRPC names the error variant)
   - A `createTauRPCProxy` function
   - The `Router` type with a `send_request` method

3. **Create `src/lib/api.ts`.** Create a thin API wrapper:
   - Import `createTauRPCProxy` from `~/bindings`
   - Export a singleton `const api = createTauRPCProxy()`
   - Export a `sendRequest` async function that takes `HttpRequestData`, calls `api.send_request(data)`, and returns `HttpResponseData`
   - This wrapper provides a clean import path and a place to add retry logic, logging, or error transformation later

4. **Update `src/stores/request-store.ts`.** Replace the local `KeyValue` and response type definitions with imports from `~/bindings`. Update the store's response field type. Ensure the `sendRequest` action is added to the store:
   - `sendRequest()` — reads current state (method, url, headers, queryParams, bodyType, bodyContent, bodyFormData), constructs an `HttpRequestData` object, calls `api.sendRequest()`, and sets the response/error/loading state accordingly.
   - This action should: set `isLoading: true`, clear previous `error`, call the API, on success set `response` and `isLoading: false`, on error set `error` message and `isLoading: false`.

5. **Decide on `.gitignore` for `bindings.ts`.** The recommendation is to **track** `bindings.ts` in git — it's small, and tracking it means frontend-only developers don't need the Rust toolchain to get TypeScript types. Add a header comment in the api.ts wrapper noting it's generated.

**Edge Cases & Gotchas:**
- TauRPC generates types at **runtime** (when the Rust binary executes), not at `cargo build` time. The dev flow requires running `bun tauri dev` at least once.
- If `bindings.ts` doesn't exist when Vite starts, TypeScript will error. Keep a minimal placeholder until first generation.
- The `RequestBody` enum in TypeScript will be a discriminated union. TauRPC/specta typically uses `{ type: "Json", data: string }` format. The Zustand store needs to construct this correctly.
- The `enabled` field on `KeyValue` is used client-side only for toggling params/headers on/off. When constructing `HttpRequestData`, filter to only `enabled: true` entries.

**Verification:**
- `bindings.ts` exists in `src/` and exports the expected types.
- `src/lib/api.ts` compiles with no TypeScript errors.
- `src/stores/request-store.ts` compiles with the imported types.
- Run `bun tauri dev` — the app launches, no crashes, the stub `send_request` handler is reachable.

**Depends On:** Step 1, Step 2
**Blocks:** Step 5

---

### Step 4: Rust HTTP Service

**Objective:** Implement the real Reqwest-based HTTP request executor that replaces the stub from Step 1, handling all MVP request types (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) with proper timing, headers, and error handling.

**Context:**
- Step 1 created a stub `execute_request` function in `src-tauri/src/http/client.rs`.
- Now we implement it for real using Reqwest.

**Scope:**
- Modify: `src-tauri/src/http/client.rs` (full implementation)
- Modify: `src-tauri/src/http/types.rs` (add any needed helper methods)

**Sub-tasks:**

1. **Create a shared Reqwest client.** In `client.rs`, create a lazily-initialized `reqwest::Client` using `once_cell::sync::Lazy` (or `std::sync::LazyLock` on Rust 1.80+). Configure it with:
   - `timeout: Duration::from_secs(30)` — default 30-second timeout
   - `redirect::Policy::limited(10)` — follow up to 10 redirects
   - `user_agent: "Alloy/0.1.0"` — identify the client
   - `rustls` TLS backend (already selected via the `rustls-tls` feature flag in Cargo.toml)

   Using a shared client enables connection pooling across requests.

2. **Implement `execute_request`.** The function should:
   
   a. **Build the URL with query params.** Start with `request.url`. Parse it with `reqwest::Url::parse()`. For each entry in `request.query_params` where `enabled` is true, append it to the URL's query pairs using `.query_pairs_mut().append_pair(key, value)`. Handle URL parse errors by returning `AppError::InvalidUrl`.
   
   b. **Build the request.** Create a `reqwest::RequestBuilder` with the correct method:
      - Parse `request.method` string to `reqwest::Method` (use `Method::from_bytes`). Support: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
      - Return `AppError::RequestError` for unknown methods.
   
   c. **Set headers.** Iterate `request.headers` (filter `enabled: true`). Parse each key/value into `reqwest::header::HeaderName` / `HeaderValue`. Skip invalid headers (log a warning, don't fail the whole request).
   
   d. **Set the body.** Match on `request.body`:
      - `RequestBody::None` — no body (default for GET, HEAD, DELETE)
      - `RequestBody::Json(content)` — set body to content string, add `Content-Type: application/json` header if not already set by user
      - `RequestBody::FormUrlEncoded(pairs)` — use `.form()` with a `Vec<(String, String)>` from enabled pairs
      - `RequestBody::Raw { content, content_type }` — set body to content string, set `Content-Type` to `content_type` if not already set
   
   e. **Send and time the request.** Record `Instant::now()` before sending. Call `.send().await`. Record elapsed time.
   
   f. **Build the response.** From the `reqwest::Response`:
      - `status`: `.status().as_u16()`
      - `status_text`: `.status().canonical_reason().unwrap_or("Unknown")` 
      - `headers`: Iterate `.headers()`, convert each to `KeyValue { key, value, enabled: true }`
      - `body`: Call `.text().await` to read the full body as a UTF-8 string (lossy)
      - `size_bytes`: Get from the `Content-Length` header if available, otherwise use `body.len() as u64`
      - `time_ms`: Elapsed time in milliseconds

   g. **Handle errors.** Convert `reqwest::Error` to appropriate `AppError` variant:
      - If `.is_timeout()` → `AppError::Timeout`
      - If `.is_connect()` → `AppError::NetworkError` with message
      - Otherwise → `AppError::RequestError` with message

3. **Add a `size_bytes` field to `HttpResponseData`.** If not already present from Step 1, ensure the response type includes `size_bytes: u64`.

**Edge Cases & Gotchas:**
- **Empty URL:** If the user sends an empty URL, `Url::parse("")` will fail. Return a clear `InvalidUrl("URL cannot be empty")` error.
- **Relative URLs:** `reqwest::Url::parse` rejects relative URLs like `/api/users`. Return `InvalidUrl("URL must include a scheme (http:// or https://)")`.
- **Header conflicts:** If the user sets `Content-Type` manually AND the body type implies one (e.g., JSON body), the user's explicit header should take precedence. Check before auto-setting.
- **Large response bodies:** `response.text().await` reads the entire body into memory. For the MVP this is acceptable, but add a TODO comment noting this should be streamed/chunked for large responses in the future.
- **Binary responses:** `.text()` with lossy UTF-8 conversion will produce garbled output for binary content. This is acceptable for the MVP. Add a TODO to detect binary Content-Type and handle differently.
- **Redirect timing:** The measured time includes redirect hops. This matches user expectations (total round-trip time).

**Verification:**
- Write a quick test in the Rust code: `#[cfg(test)] mod tests { ... }` with a test that creates an `HttpRequestData` for `GET https://httpbin.org/get` and calls `execute_request`. Assert the response status is 200.
- Alternatively, verify by running the full app and sending a GET request from the UI (after Step 8).

**Depends On:** Step 1
**Blocks:** Step 8

---

### Step 5: Request Builder UI — URL Bar & Method Selector

**Objective:** Build the top section of the request builder: a horizontal bar with an HTTP method dropdown, a URL input field, and a Send button.

**Context:**
- Step 2 created `RequestPanel.tsx` as a placeholder.
- The Zustand store from Step 2/3 has `method`, `url`, `isLoading`, and `sendRequest()`.
- shadcn components are available (Button is already installed; other components will need to be added via the shadcn CLI).

**Scope:**
- Modify: `src/components/request/RequestPanel.tsx` (replace placeholder)
- Create: `src/components/request/MethodSelector.tsx`
- Create: `src/components/request/UrlBar.tsx`
- Create: `src/components/request/SendButton.tsx`
- Install shadcn components as needed (via `bunx shadcn@latest add <component>`)

**Sub-tasks:**

1. **Install required shadcn components.** Run:
   - `bunx shadcn@latest add select` — for method dropdown
   - `bunx shadcn@latest add input` — for URL input
   - `bunx shadcn@latest add tabs` — for request/response tabs (used in Steps 6 & 7)
   - `bunx shadcn@latest add badge` — for status codes
   - `bunx shadcn@latest add separator` — for dividers
   - `bunx shadcn@latest add tooltip` — for button tooltips

2. **Create `src/components/request/MethodSelector.tsx`.** A dropdown/select component:
   - Uses shadcn `Select` component
   - Options: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
   - Each method should have a distinct color (GET = green, POST = yellow/amber, PUT = blue, PATCH = purple, DELETE = red, HEAD = gray, OPTIONS = gray). Apply these as text colors.
   - Reads `method` from Zustand store, calls `setMethod()` on change.
   - Width should be fixed (~120px) so the URL bar layout doesn't shift when changing methods.

3. **Create `src/components/request/UrlBar.tsx`.** A text input:
   - Uses shadcn `Input` component (or a plain `<input>` with Tailwind styling for more control)
   - Reads `url` from Zustand store, calls `setUrl()` on change.
   - Placeholder text: `"Enter request URL..."`
   - On change, call `syncUrlToQueryParams()` to keep the Params tab in sync.
   - Should flex-grow to fill available horizontal space.
   - Pressing `Enter` should trigger `sendRequest()`.

4. **Create `src/components/request/SendButton.tsx`.** A button:
   - Uses shadcn `Button` component with the default (primary) variant
   - Label: "Send" (with a send/arrow icon from `@tabler/icons-react`, e.g., `IconSend`)
   - Disabled state: when `isLoading` is true, show a spinner/loading indicator and text "Sending..."
   - On click: calls `sendRequest()` from the Zustand store.
   - Use `size="lg"` for visual prominence.

5. **Update `src/components/request/RequestPanel.tsx`.** Compose the URL bar row:
   - Layout: horizontal flex row with gap-2, padding `p-3`
   - Order: `<MethodSelector />` `<UrlBar />` `<SendButton />`
   - Below the URL bar: leave a placeholder div for the tabs (Step 6)

**Edge Cases & Gotchas:**
- The method selector's color coding is cosmetic but important for UX — users quickly identify request types by color. Use Tailwind text color classes conditionally.
- The URL input should NOT debounce — sync immediately on change so the Params tab stays current.
- The `Enter` key handler on UrlBar should use `onKeyDown` and check for `e.key === "Enter"`. Make sure it doesn't trigger if a modifier key (Ctrl, Shift) is held.
- The Send button should be `type="button"` (not `"submit"`) to avoid form submission behavior.

**Verification:**
- Run `bun run dev`. The top of the request panel shows a method dropdown, URL input, and Send button side by side.
- Changing the method dropdown updates the Zustand store (verify via React DevTools or console log).
- Typing a URL updates the store.
- Clicking Send (or pressing Enter) calls `sendRequest()` — at this point it may error since the backend isn't fully wired, but it should not crash.

**Depends On:** Step 2
**Blocks:** Step 8

---

### Step 6: Request Detail Tabs — Params, Headers, Body

**Objective:** Build the tabbed interface below the URL bar for editing query parameters, request headers, and the request body (with CodeMirror for JSON/raw and a key-value table for form-urlencoded).

**Context:**
- Step 5 built the URL bar row and left a placeholder for tabs.
- The Zustand store has `headers`, `queryParams`, `bodyType`, `bodyContent`, `bodyFormData`, `activeRequestTab`.

**Scope:**
- Modify: `src/components/request/RequestPanel.tsx` (add tabs)
- Create: `src/components/request/ParamsEditor.tsx`
- Create: `src/components/request/HeadersEditor.tsx`
- Create: `src/components/request/BodyEditor.tsx`
- Create: `src/components/request/KeyValueEditor.tsx` (shared component for params/headers/form-data)

**Sub-tasks:**

1. **Create `src/components/request/KeyValueEditor.tsx`.** This is a reusable table component for editing key-value pairs (used by Params, Headers, and Form-data). It should:
   - Accept props: `items: KeyValue[]`, `onChange: (items: KeyValue[]) => void`, `keyPlaceholder?: string`, `valuePlaceholder?: string`
   - Render a table-like layout with columns: Checkbox (enabled toggle), Key input, Value input, Delete button
   - Each row is a `KeyValue` entry
   - Automatically add a new empty row when the user starts typing in the last row (auto-expand behavior, like Postman)
   - The delete button (X icon from tabler) removes the row (but never removes the last row — always keep at least one empty row)
   - The checkbox toggles the `enabled` field
   - Use compact styling: small inputs, tight padding, monospace font for values
   - Use `@tabler/icons-react` for the delete icon (`IconX` or `IconTrash`)

2. **Create `src/components/request/ParamsEditor.tsx`.** Wraps `KeyValueEditor`:
   - Reads `queryParams` from Zustand store
   - On change: calls `setQueryParams(newParams)` then `syncQueryParamsToUrl()`
   - Key placeholder: "Parameter name"
   - Value placeholder: "Value"

3. **Create `src/components/request/HeadersEditor.tsx`.** Wraps `KeyValueEditor`:
   - Reads `headers` from Zustand store
   - On change: calls `setHeaders(newHeaders)`
   - Key placeholder: "Header name"
   - Value placeholder: "Value"
   - Future enhancement (post-MVP): autocomplete suggestions for common headers (Content-Type, Authorization, Accept, etc.)

4. **Create `src/components/request/BodyEditor.tsx`.** A compound component with:
   - A body type selector row at the top: radio buttons or a small segmented control for "None", "JSON", "Form URL-Encoded", "Raw"
   - Reads `bodyType` from Zustand, calls `setBodyType()` on change
   - Conditional rendering based on `bodyType`:
     - `"none"` — show a muted text message "This request does not have a body"
     - `"json"` — render a CodeMirror editor with JSON language support. Import `@uiw/react-codemirror` with `@codemirror/lang-json`. Bind value to `bodyContent`, onChange to `setBodyContent()`. Use a dark/light theme that matches the app's theme.
     - `"form-urlencoded"` — render `KeyValueEditor` bound to `bodyFormData` / `setBodyFormData()`
     - `"raw"` — render a CodeMirror editor with no specific language mode (or auto-detect from `rawContentType`). Add a small dropdown next to the "Raw" radio to select content type: "Text", "XML", "HTML", "JavaScript". Bind value to `bodyContent`, onChange to `setBodyContent()`.
   - CodeMirror configuration: line numbers on, basic setup extensions, height should fill available space (use `height: "100%"` and `flex: 1` on the parent container), set `minHeight: "100px"`.

5. **Update `src/components/request/RequestPanel.tsx`.** Add the shadcn `Tabs` component below the URL bar:
   - Tab triggers: "Params", "Headers", "Body"
   - Active tab state read from `activeRequestTab` in Zustand, set via `setActiveRequestTab()`
   - Tab content area should fill remaining vertical space (`flex-1 overflow-auto`)
   - Each tab renders its respective component: `ParamsEditor`, `HeadersEditor`, `BodyEditor`

**Edge Cases & Gotchas:**
- **Auto-expand rows:** The KeyValueEditor must generate new `id` values (via `crypto.randomUUID()`) for new rows. Don't use array index as React key.
- **Query param sync loop:** Editing params triggers `syncQueryParamsToUrl` which updates the URL. Editing the URL triggers `syncUrlToQueryParams` which updates params. This can cause an infinite loop. Prevent by: only calling `syncQueryParamsToUrl` from ParamsEditor changes, and only calling `syncUrlToQueryParams` from UrlBar changes. Never call both in the same update.
- **CodeMirror controlled mode:** `@uiw/react-codemirror` supports `value` and `onChange` for controlled mode. Be careful about cursor position — the library handles this, but avoid unnecessary re-renders by using `useCallback` for the onChange handler.
- **CodeMirror height:** CodeMirror needs an explicit height or a flex container. Wrap it in a `div` with `flex: 1; overflow: hidden;` and pass `height="100%"` to the CodeMirror component.
- **Body type reset:** When switching body type, don't clear the previous content — the user might switch back. Each type's content is stored independently (`bodyContent` for JSON/Raw, `bodyFormData` for form-urlencoded).

**Verification:**
- Run `bun run dev`. Below the URL bar, three tabs appear: Params, Headers, Body.
- Params tab: shows a key-value table. Adding a param with key `page` and value `1` updates the URL to include `?page=1`.
- Headers tab: shows a key-value table. Can add/remove/toggle headers.
- Body tab: shows type selector. Selecting "JSON" shows a CodeMirror editor with JSON syntax highlighting. Selecting "Form URL-Encoded" shows a key-value table. Selecting "None" shows a message.
- Typing valid JSON in the JSON editor (e.g., `{"name": "test"}`) is stored in the Zustand store.

**Depends On:** Step 2, Step 5
**Blocks:** Step 8

---

### Step 7: Response Viewer UI

**Objective:** Build the bottom panel that displays the HTTP response: a status bar with status code, time, and size, plus tabs for the formatted response body (in CodeMirror, read-only) and response headers.

**Context:**
- Step 2 created `ResponsePanel.tsx` as a placeholder.
- The Zustand store has `response`, `isLoading`, `error`, and `activeResponseTab`.
- CodeMirror is installed (Step 6).

**Scope:**
- Modify: `src/components/response/ResponsePanel.tsx` (replace placeholder)
- Create: `src/components/response/StatusBar.tsx`
- Create: `src/components/response/ResponseBody.tsx`
- Create: `src/components/response/ResponseHeaders.tsx`
- Create: `src/components/response/EmptyState.tsx`

**Sub-tasks:**

1. **Create `src/components/response/EmptyState.tsx`.** Displayed when `response` is null and `isLoading` is false and `error` is null:
   - A centered message: "Send a request to see the response" (or similar)
   - Muted text color, possibly with a subtle icon (e.g., `IconArrowUp` or `IconSend` from tabler)
   - Takes up full height of the response panel

2. **Create `src/components/response/StatusBar.tsx`.** A horizontal bar at the top of the response panel:
   - Reads `response` from Zustand
   - Displays three items in a row with spacing:
     - **Status code badge**: Use shadcn `Badge` component. Color-code by status range:
       - 2xx → green
       - 3xx → yellow/amber
       - 4xx → red
       - 5xx → red (darker/more severe)
     - Display format: "200 OK" or "404 Not Found" (status + status_text)
     - **Time**: Display as "150 ms" or "1.2 s" (convert ms to seconds if ≥ 1000). Use a small clock icon.
     - **Size**: Display as "1.5 KB" or "2.3 MB" (human-readable). Use a small download/data icon.
   - All items use monospace font for numerical values.
   - If `isLoading` is true, show a loading indicator (animated dots or spinner) instead of the status info.
   - If `error` is not null, show the error message in red text with a warning icon.

3. **Create `src/components/response/ResponseBody.tsx`.** The response body viewer:
   - Reads `response.body` from Zustand
   - Renders in a CodeMirror editor in **read-only** mode (`editable: false`, `readOnly: true`)
   - Auto-detect language from `Content-Type` response header:
     - `application/json` → JSON language mode, and **pretty-print** the body (try `JSON.parse` then `JSON.stringify(parsed, null, 2)`)
     - `text/html` → HTML language mode
     - `text/xml` or `application/xml` → XML language mode
     - Everything else → no language mode (plain text)
   - CodeMirror should fill available space (flex container with `height: 100%`)
   - Add line numbers, code folding for JSON
   - If the body is very large (>1MB), show a warning message and truncate: "Response body is X MB. Showing first 1MB." with a future "Save to file" button placeholder.

4. **Create `src/components/response/ResponseHeaders.tsx`.** Displays response headers:
   - Reads `response.headers` from Zustand
   - Renders as a simple table/list: `Header-Name: value` with monospace font
   - Use alternating row backgrounds (zebra striping) for readability
   - Headers are read-only (no editing)
   - Show the total count of headers in the tab label: "Headers (12)"

5. **Update `src/components/response/ResponsePanel.tsx`.** Compose the response viewer:
   - If no response, no loading, and no error → render `<EmptyState />`
   - Otherwise render:
     - `<StatusBar />` at the top
     - shadcn `Tabs` below for "Body" and "Headers"
     - Active tab from `activeResponseTab` in Zustand
     - Tab content fills remaining space

**Edge Cases & Gotchas:**
- **JSON pretty-print failure:** If `JSON.parse` fails on a `application/json` response (malformed JSON), fall back to displaying the raw body without formatting. Don't show an error — just show raw text.
- **Empty response body:** Some responses (204 No Content, HEAD responses) have no body. Show "No response body" message instead of an empty editor.
- **Size calculation:** Use the `size_bytes` field from the backend response. If it's 0, fall back to `new Blob([response.body]).size` for display.
- **Status text mapping:** The backend returns `status_text` from reqwest's `canonical_reason()`. If it's empty (custom status codes), just show the numeric code.
- **CodeMirror theme consistency:** Use the same CodeMirror theme in both the request body editor (Step 6) and response body viewer. Extract theme configuration to a shared file like `src/lib/codemirror-theme.ts`.

**Verification:**
- Run `bun run dev`. The bottom panel shows the empty state message.
- (Full verification requires Step 8 — wiring everything together.)

**Depends On:** Step 2
**Blocks:** Step 8

---

### Step 8: End-to-End Wiring & Polish

**Objective:** Connect all layers — UI → Zustand → TauRPC → Rust/Reqwest — so the user can send a real HTTP request and see the response. Fix integration issues, add loading states, and polish the UX.

**Context:**
- Steps 1-4 built the backend (TauRPC + Reqwest).
- Steps 5-7 built the frontend (URL bar, tabs, response viewer).
- Step 3 created the Zustand `sendRequest` action and `api.ts` wrapper.
- Now we need to run the full Tauri app and verify the complete flow works.

**Scope:**
- Modify: `src/stores/request-store.ts` (finalize `sendRequest` action)
- Modify: `src-tauri/capabilities/default.json` (add required permissions)
- Modify: `src-tauri/tauri.conf.json` (window size, title)
- Potential fixes to any file from previous steps based on integration testing

**Sub-tasks:**

1. **Update `src-tauri/tauri.conf.json`.** Adjust the window configuration:
   - Set `width` to 1200 and `height` to 800 (larger default for an API client)
   - Set `title` to "Alloy"
   - Set `minWidth` to 800 and `minHeight` to 500
   - Optionally enable `"decorations": true` and `"resizable": true` (should be defaults)

2. **Update `src-tauri/capabilities/default.json`.** Ensure permissions include what's needed. For MVP, the default `core:default` and `opener:default` should suffice since all HTTP requests go through TauRPC (Rust-side reqwest), not through the webview. No additional Tauri plugin permissions are needed for the MVP.

3. **Finalize `sendRequest` in Zustand store.** Verify the action correctly:
   - Constructs `HttpRequestData` from store state:
     - Filter headers/queryParams to only `enabled: true` entries
     - Strip the client-side `id` field from `KeyValue` before sending (the Rust side expects `{ key, value, enabled }`)
     - Map `bodyType` + `bodyContent`/`bodyFormData` to the `RequestBody` enum variant (matching the exact discriminated union shape from `bindings.ts`)
   - Calls `api.sendRequest()` with the constructed data
   - Handles the response and error cases

4. **Run `bun tauri dev` and test the full flow.** Execute these test cases:
   - **Test 1: Simple GET.** Enter `https://httpbin.org/get` with GET method. Click Send. Expect: 200 OK response, JSON body with request details, headers visible.
   - **Test 2: POST with JSON body.** Enter `https://httpbin.org/post` with POST method. Switch to Body tab, select JSON, enter `{"name": "Alloy", "version": "0.1.0"}`. Click Send. Expect: 200 OK, response body includes the sent JSON in the `json` field.
   - **Test 3: Custom headers.** Enter `https://httpbin.org/headers` with GET. Add header `X-Custom: hello`. Click Send. Expect: response shows the custom header.
   - **Test 4: Query params.** Enter `https://httpbin.org/get`. In Params tab, add `page=1` and `limit=10`. Click Send. Expect: URL updates to include `?page=1&limit=10`, response shows the args.
   - **Test 5: Error handling.** Enter `https://nonexistent.invalid`. Click Send. Expect: Error message displayed (DNS resolution failure), no crash.
   - **Test 6: 404 response.** Enter `https://httpbin.org/status/404`. Click Send. Expect: 404 status badge in red.

5. **Fix integration issues.** Based on testing, fix any issues that arise. Common problems:
   - TauRPC discriminated union shape mismatch between frontend and backend
   - CORS-like issues (shouldn't happen since requests go through Rust, not the webview)
   - Body encoding issues (ensure UTF-8 handling)
   - Missing or incorrect type mappings in `bindings.ts`

6. **Add UX polish:**
   - Add keyboard shortcut: `Ctrl+Enter` / `Cmd+Enter` to send the request from anywhere in the app (add a global `keydown` listener in `App.tsx`)
   - Add a subtle border or shadow to the resize handle to make it more visible
   - Ensure the CodeMirror themes match the app's light/dark mode (use `@codemirror/theme-one-dark` for dark mode or the default light theme)
   - Add a "Copy response body" button (small clipboard icon) in the response body tab header
   - Ensure monospace font (`font-mono` in Tailwind) is used for URL input, header values, and code editors

7. **Verify the complete app builds for production.** Run `bun tauri build` and ensure the app compiles and packages correctly. This validates the entire toolchain.

**Edge Cases & Gotchas:**
- **TauRPC type mismatch:** The most likely integration issue. If the TypeScript types from `bindings.ts` don't match what the frontend is constructing, the IPC call will fail silently or throw a deserialization error on the Rust side. Check Rust logs in the terminal where `tauri dev` is running.
- **RequestBody enum construction:** TauRPC/specta serializes Rust enums as tagged unions. `RequestBody::Json("...")` might appear in TypeScript as `{ type: "Json", data: "..." }` or `{ Json: "..." }` depending on serde configuration. Inspect `bindings.ts` carefully to match the exact shape.
- **Async timing:** The `sendRequest` action is async. Ensure the Zustand store handles the case where the user clicks Send again while a request is in flight. For MVP: just let requests fire concurrently and last-write-wins for the response state.
- **Window title:** Tauri uses both `tauri.conf.json` title and the `<title>` in `index.html`. Update both for consistency.

**Verification:**
- All 6 test cases from sub-task 4 pass.
- The app launches cleanly with `bun tauri dev`.
- `bun tauri build` completes without errors.
- No console errors or Rust panics during normal use.
- The UI feels responsive: loading states appear immediately, responses render quickly.

**Depends On:** Steps 1, 2, 3, 4, 5, 6, 7
**Blocks:** None (this is the final MVP step)

---

## Post-MVP Feature Roadmap (Placeholders)

The following features are **out of scope** for this MVP plan but represent the natural next steps. Each would be its own plan document:

### Phase 2: Organization & Persistence
- **Collections & .http File Persistence** — Save requests as `.http` files in the workspace directory structure (`.alloy/` folder model). Integrate `rest_parser` crate for parsing existing `.http` files. Add a sidebar with a file tree for browsing collections.
- **Environments & Variables** — TOML-based environment files (`.alloy/environments/*.toml`). Handlebars templating for `{{variable}}` substitution in URLs, headers, and bodies. Environment selector in the UI toolbar.
- **Request History (SQLite)** — Add `tauri-plugin-sql` or `rusqlite` for a SQLite database in the app data directory. Log every sent request/response with timestamp. History panel in the sidebar.

### Phase 3: Advanced Request Features
- **Form-data / Multipart** — File picker dialog (`tauri-plugin-dialog`) for file uploads. Multipart body construction using reqwest's multipart API.
- **Authentication Presets** — UI for Bearer token, Basic auth, OAuth 2.0 flows. Auto-populate Authorization header.
- **Cookie Management** — Cookie jar persistence, cookie viewer in response panel.
- **SSL/TLS Options** — Toggle to skip certificate verification. Client certificate support.
- **Request Timeout Configuration** — Per-request timeout override.

### Phase 4: Response & UX Polish
- **Response Search/Filter** — Text search within JSON response bodies. JSONPath or jq-like filtering.
- **Binary Response Handling** — Image preview, hex viewer, save-to-file for binary content.
- **Response History Diff** — Compare two responses side-by-side.
- **Import/Export** — Import from Postman collections, cURL commands. Export to `.http` files.
- **Keyboard Shortcuts** — Full shortcut system (new request, switch tabs, focus URL bar, etc.).
- **Theme Customization** — Light/dark mode toggle, custom accent colors.

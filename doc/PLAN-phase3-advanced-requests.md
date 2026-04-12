# Alloy — Phase 3: Advanced Request Features

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Extend Alloy's request builder with production-grade HTTP features: multipart/form-data file uploads, authentication presets (Bearer token, Basic auth), cookie inspection, SSL/TLS certificate options, and per-request timeout configuration. These features close the gap with Postman for real-world API testing workflows.

### 1.2 — Approach Summary

Each feature is a vertical slice adding backend support (Rust/Reqwest) and frontend UI. The existing architecture (TauRPC IPC, Zustand store, tabbed request builder) absorbs these additions cleanly:

- **Multipart form-data:** Reqwest already has `multipart` feature enabled. Add a new body type in the UI with file picker integration via `tauri-plugin-dialog`.
- **Auth presets:** A new "Auth" tab in the request builder that auto-generates the `Authorization` header. No backend changes needed — auth is a header transformation on the frontend.
- **Cookies:** Reqwest's `cookies` feature is already enabled. Add a "Cookies" response tab that displays `Set-Cookie` headers parsed into a table.
- **SSL/TLS options:** Add a per-request toggle to skip certificate verification. Requires creating a second reqwest client instance with `danger_accept_invalid_certs(true)`.
- **Timeout:** Add a per-request timeout override field. Pass to backend, use `reqwest::RequestBuilder::timeout()`.

### 1.3 — Decisions Log

- **Decision:** Multipart file data is streamed from disk, not loaded into memory.
  - **Rationale:** Large files (video, archives) shouldn't be buffered in RAM. Reqwest's `multipart::Part::stream` with a file handle is used.

- **Decision:** Auth presets are a frontend-only feature that generates headers.
  - **Alternatives:** Backend-side auth handling, dedicated auth middleware.
  - **Rationale:** Auth presets (Bearer, Basic) are simply header generation. Keeping this on the frontend means no IPC round-trip for header computation. OAuth 2.0 flows (which need backend network calls) are deferred to a future phase.

- **Decision:** SSL skip uses a separate reqwest::Client instance, not a global toggle.
  - **Rationale:** A global toggle would affect all concurrent requests. Per-request toggling requires selecting between a secure and an insecure client.

- **Decision:** Cookie viewer is read-only (no editing/creating cookies manually).
  - **Rationale:** For API testing, inspecting Set-Cookie headers is the primary need. Full cookie jar management with manual editing is deferred.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- Phase 2 (workspace, tabs, environments) is complete.
- The file picker from `tauri-plugin-dialog` is available (added in Phase 2).
- OAuth 2.0 and other complex auth flows are out of scope for this phase.

**Open Questions:**
- Should cookies persist across requests in the same tab/session? (For v1: no persistence — each request is independent.)
- Should SSL skip be a global setting or per-request? (Per-request via a checkbox, with a future global default in settings.)

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Large file uploads cause memory spikes | Low | Medium | Use reqwest multipart streaming from file handle, not memory buffer |
| Two reqwest clients (secure/insecure) double connection overhead | Low | Low | Connections are pooled per-client; most requests use the secure client |
| Cookie parsing edge cases (complex Set-Cookie headers) | Medium | Low | Use a simple split-and-display approach; don't try to parse all cookie attributes |

### 1.6 — Step Sequence Overview

```
1. Rust: Multipart form-data backend    — file reading, multipart body construction
2. Frontend: Multipart body editor UI   — file picker, part list, form-data key-value editor
3. Frontend: Auth presets tab            — Bearer/Basic auth UI, header auto-generation
4. Frontend: Cookie viewer tab           — parse Set-Cookie headers, display table
5. Rust: SSL/TLS and timeout options     — insecure client, per-request timeout
6. Frontend: Request options UI          — SSL toggle, timeout input, options panel
```

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Rust — Multipart Form-Data Backend

**Objective:** Extend the Rust HTTP client to support multipart/form-data requests with file uploads.

**Context:**
- The existing `RequestBody` enum has `None`, `Json`, `FormUrlEncoded`, and `Raw` variants.
- We need a new `Multipart` variant that can include text fields and file parts.
- Reqwest's `multipart` feature is already enabled in `Cargo.toml`.
- Files are referenced by path (not uploaded to the backend as bytes). The Rust backend reads files directly from disk.

**Scope:**
- Modify: `src-tauri/src/http/types.rs` (add Multipart types)
- Modify: `src-tauri/src/http/client.rs` (handle multipart body construction)

**Sub-tasks:**

1. **Add multipart types to `types.rs`:**
   - `MultipartField { key: String, value: MultipartValue, content_type: Option<String>, enabled: bool }` — a single form field
   - `MultipartValue` enum: `Text(String)` | `File { path: String, filename: Option<String> }` — either a text value or a file reference
   - Add `Multipart(Vec<MultipartField>)` variant to the `RequestBody` enum.
   
   Use `#[taurpc::ipc_type]` for the new types so TypeScript bindings are generated.

2. **Update `execute_request` in `client.rs`.** Add a `RequestBody::Multipart(fields)` match arm:
   - Create a `reqwest::multipart::Form`.
   - For each enabled field:
     - If `MultipartValue::Text(text)`: add `form.text(key, text)`.
     - If `MultipartValue::File { path, filename }`: 
       - Read the file using `tokio::fs::read(path).await`. 
       - Create a `reqwest::multipart::Part::bytes(data)` with the filename set via `.file_name(filename.unwrap_or(path_basename))`.
       - If `content_type` is set, add `.mime_str(content_type)`.
       - Add to form with `form.part(key, part)`.
   - Set the form on the builder: `builder.multipart(form)`.
   - Do NOT manually set Content-Type header — reqwest sets it automatically with the correct boundary.

3. **Add file-related error variants** to `error.rs`:
   - `FileNotFound(String)` — if the referenced file doesn't exist.
   - `FileReadError(String)` — if the file can't be read.

**Edge Cases & Gotchas:**
- **Content-Type for multipart:** Reqwest automatically sets `Content-Type: multipart/form-data; boundary=...`. If the user manually set a Content-Type header, it should be overridden/removed for multipart requests. Check `has_content_type_header` and skip auto-setting logic.
- **Large files:** Reading entire files into memory with `tokio::fs::read` works for files up to ~100MB. For very large files, use `reqwest::multipart::Part::stream` with a file reader. For v1, memory buffering is acceptable with a file size check (warn if >100MB).
- **File path validation:** Validate that the file exists before starting the multipart construction. Return a clear `FileNotFound` error.
- **Filename extraction:** If no explicit filename is provided, extract it from the file path using `Path::file_name()`.

**Verification:**
- Unit test: construct a multipart request with one text field and mock the file read.
- Manual test: send a multipart request to `https://httpbin.org/post` with a text field and a small file → verify the response shows both parts.

**Depends On:** Phase 2 complete
**Blocks:** Step 2

---

### Step 2: Frontend — Multipart Body Editor UI

**Objective:** Add a "Form Data" body type option in the request builder with a UI for adding text fields and file attachments.

**Context:**
- Step 1 added `Multipart` variant to `RequestBody`.
- The body editor (`BodyEditor.tsx`) currently has: None, JSON, Form URL-Encoded, Raw.
- We add "Form Data" as a new option.

**Scope:**
- Modify: `src/components/request/BodyEditor.tsx` (add Form Data option)
- Create: `src/components/request/MultipartEditor.tsx`
- Modify: `src/stores/request-store.ts` (add multipart state to Tab)
- Modify: `src/lib/api.ts` (add file picker API call)

**Sub-tasks:**

1. **Update Tab state in `request-store.ts`.** Add to the `Tab` interface:
   - `multipartFields: MultipartField[]` (matches the Rust type from bindings)
   - Add `"form-data"` to the `BodyType` union type.
   - Update `toRequestBody` to handle `"form-data"` → construct the `Multipart` variant for the IPC call.

2. **Add file picker API to `api.ts`.**
   - `pickFile(filters?)` — calls `api.workspace.pick_file()` or use a dedicated TauRPC procedure that wraps `tauri_plugin_dialog` file picker for selecting upload files. If this wasn't added in Phase 2, add a new `pick_file` procedure on the workspace API that returns the selected file path as a string.

3. **Create `src/components/request/MultipartEditor.tsx`.** A form-data editor:
   - Similar layout to `KeyValueEditor` but with an extra column for the value type.
   - Columns: Checkbox (enabled), Key input, Type toggle (Text/File), Value input or File picker, Delete button.
   - For `Text` type: standard text input for the value.
   - For `File` type: show the filename (truncated) with a "Browse" button that triggers the file picker. Display file size next to the name.
   - Auto-expand: new empty row appears when the user starts typing in the last row (same pattern as `KeyValueEditor`).
   - Each row's state: `{ key, valueType: "text" | "file", textValue, filePath, fileName, contentType, enabled, id }`.
   - Optional: Content-Type dropdown per part (auto-detected from file extension, but overridable).

4. **Update `BodyEditor.tsx`.** Add "Form Data" to `BODY_TYPE_OPTIONS` (between "Form URL-Encoded" and "Raw"). When selected, render `<MultipartEditor />`.

**Edge Cases & Gotchas:**
- **File path display:** Show only the filename and size, not the full path (for cleanliness and cross-platform consistency).
- **File deletion:** If the user selects a file and then deletes it from disk before sending, the backend will return `FileNotFound`. Display this error clearly.
- **Mixed fields:** A multipart form can have both text and file fields. The editor must support mixing them freely.
- **File picker cancellation:** If the user cancels the file picker, keep the row as-is (don't clear it).

**Verification:**
- Select "Form Data" in body type → multipart editor appears.
- Add a text field "name" = "test" and a file field "avatar" → pick a file.
- Send to `https://httpbin.org/post` → response shows both `form` (text fields) and `files` (uploaded files).

**Depends On:** Step 1
**Blocks:** None

---

### Step 3: Frontend — Auth Presets Tab

**Objective:** Add an "Auth" tab to the request builder with presets for Bearer Token and Basic Authentication that auto-generate the `Authorization` header.

**Context:**
- Auth presets are purely a frontend feature — they compute and set the `Authorization` header value.
- No backend changes needed.
- The request builder has tabs: Params, Headers, Body. We add "Auth" as a fourth tab.

**Scope:**
- Create: `src/components/request/AuthEditor.tsx`
- Modify: `src/components/request/RequestPanel.tsx` (add Auth tab)
- Modify: `src/stores/request-store.ts` (add auth state to Tab)

**Sub-tasks:**

1. **Update Tab state in `request-store.ts`.** Add to the `Tab` interface:
   - `authType: "none" | "bearer" | "basic"` (default: `"none"`)
   - `authBearer: string` (bearer token value, default: `""`)
   - `authBasicUsername: string` (default: `""`)
   - `authBasicPassword: string` (default: `""`)
   - Add `"auth"` to the `RequestTab` union type.
   - Update `sendRequest()`: before constructing `HttpRequestData`, if `authType` is not "none", auto-inject the `Authorization` header into the headers list:
     - Bearer: `Authorization: Bearer {token}`
     - Basic: `Authorization: Basic {base64(username:password)}`
   - Use `btoa(username + ":" + password)` for Base64 encoding on the frontend.
   - If the user has also manually set an `Authorization` header in the Headers tab, the auth preset takes precedence (or show a warning — implementation choice).

2. **Create `src/components/request/AuthEditor.tsx`.** The auth tab content:
   - Auth type selector: segmented control/radio buttons for "None", "Bearer Token", "Basic Auth".
   - **None:** show message "This request does not use authentication."
   - **Bearer Token:** single input field for the token value. Label: "Token". Placeholder: "Enter token...". The input should support `{{variable}}` templates (displayed as-is, resolved at send-time).
   - **Basic Auth:** two input fields: "Username" and "Password". Password field should be type `password` with a show/hide toggle (eye icon).
   - Below the inputs: a read-only preview of the generated `Authorization` header value (e.g., `Bearer eyJhbG...` or `Basic dXNlcjpwYXNz`). Muted text style.
   - A note: "The Authorization header will be auto-added when sending the request."

3. **Update `RequestPanel.tsx`.** Add the "Auth" tab:
   - Add `<TabsTrigger value="auth">Auth</TabsTrigger>` after the "Body" trigger.
   - Add `<TabsContent value="auth"><AuthEditor /></TabsContent>`.

**Edge Cases & Gotchas:**
- **Header conflict:** If the user sets `authType: "bearer"` AND manually adds an `Authorization` header in the Headers tab, the auth preset should take precedence. Remove or skip the manual header when auth preset is active. Show a small warning message in the Headers tab: "Authorization header is managed by the Auth tab."
- **Variable support in auth:** Bearer tokens and Basic credentials should support `{{variable}}` syntax. These are resolved at send-time along with all other template variables.
- **Base64 encoding:** Use `btoa()` for Base64 in the browser. Handle non-ASCII characters gracefully (use `TextEncoder` → `Uint8Array` → `btoa` for full Unicode support).
- **Empty auth:** If Bearer is selected but the token is empty, don't add the header (or add it empty — user's choice). Show a visual warning that the token is empty.

**Verification:**
- Select "Bearer Token" → enter a token → send request to `https://httpbin.org/headers` → response shows `Authorization: Bearer <token>`.
- Select "Basic Auth" → enter username "user" password "pass" → send to `https://httpbin.org/basic-auth/user/pass` → 200 OK.
- Switch to "None" → the Authorization header is not sent.
- Auth with `{{variables}}` → resolved correctly at send-time with active environment.

**Depends On:** Phase 2 complete (tabs, environments)
**Blocks:** None

---

### Step 4: Frontend — Cookie Viewer Tab

**Objective:** Add a "Cookies" tab to the response viewer that parses and displays `Set-Cookie` response headers in a readable table format.

**Context:**
- Cookies are already returned by reqwest in the response headers.
- `Set-Cookie` headers contain structured data: name, value, domain, path, expires, secure, httponly, samesite.
- This is a read-only display — no cookie editing or jar management.

**Scope:**
- Create: `src/components/response/ResponseCookies.tsx`
- Modify: `src/components/response/ResponsePanel.tsx` (add Cookies tab)

**Sub-tasks:**

1. **Create `src/components/response/ResponseCookies.tsx`.** A table displaying parsed cookies:
   - Extract all `set-cookie` headers from `response.headers` (case-insensitive match).
   - Parse each `Set-Cookie` value into structured fields:
     - Split on `;` to get attributes.
     - First part is `name=value`.
     - Subsequent parts are attributes: `Domain=...`, `Path=...`, `Expires=...`, `Max-Age=...`, `Secure`, `HttpOnly`, `SameSite=...`.
   - Render as a table with columns: Name, Value, Domain, Path, Expires, Secure, HttpOnly, SameSite.
   - Boolean attributes (Secure, HttpOnly) show as checkmarks.
   - If no cookies in the response, show "No cookies in this response."
   - Value column should be truncatable with tooltip for long values.
   - Use monospace font for cookie values.

2. **Update `ResponsePanel.tsx`.** Add a "Cookies" tab:
   - Tab trigger: `Cookies ({count})` where count is the number of Set-Cookie headers.
   - Tab content: `<ResponseCookies />`.
   - Place between "Headers" and any future tabs.

**Edge Cases & Gotchas:**
- **Multiple Set-Cookie headers:** HTTP allows multiple `Set-Cookie` headers (they're not comma-joined like other headers). Each one is a separate cookie. The response `headers: Vec<KeyValue>` from the backend may have multiple entries with key `set-cookie`.
- **Parsing edge cases:** Cookie values can contain `=` signs (Base64 tokens), commas, and other special characters. Parse carefully — split on `;` first, then split first token on `=` only at the first `=`.
- **Expires format:** HTTP dates are in a specific format (e.g., `Thu, 01 Dec 2024 16:00:00 GMT`). Display as-is; don't try to parse into a local date.
- **Empty cookie table:** If no Set-Cookie headers, show the empty state message, not an empty table.

**Verification:**
- Send a request to a server that sets cookies (e.g., `https://httpbin.org/cookies/set?name=value`) → Cookies tab shows the cookie name, value, and attributes.
- Response with no cookies → "No cookies" message.
- Response with multiple Set-Cookie headers → each cookie in its own row.

**Depends On:** Phase 2 complete
**Blocks:** None

---

### Step 5: Rust — SSL/TLS and Per-Request Timeout Options

**Objective:** Add backend support for skipping SSL certificate verification and overriding the request timeout on a per-request basis.

**Context:**
- The current HTTP client uses a shared `reqwest::Client` with default settings (30s timeout, cert verification enabled).
- For SSL skip: we need a second client instance with `danger_accept_invalid_certs(true)`.
- For timeout override: use `reqwest::RequestBuilder::timeout()` which overrides the client default.

**Scope:**
- Modify: `src-tauri/src/http/types.rs` (add options to HttpRequestData)
- Modify: `src-tauri/src/http/client.rs` (insecure client, timeout override)

**Sub-tasks:**

1. **Add request options to `types.rs`.** Add fields to `HttpRequestData`:
   - `timeout_ms: Option<u64>` — per-request timeout override in milliseconds. `None` uses the default 30s.
   - `skip_ssl_verification: bool` — if true, use the insecure client. Default: `false`.

2. **Create a second static client in `client.rs`.** Add:
   ```
   static INSECURE_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
       reqwest::Client::builder()
           .timeout(Duration::from_secs(30))
           .redirect(Policy::limited(10))
           .user_agent("Alloy/0.1.0")
           .danger_accept_invalid_certs(true)
           .build()
           .expect("failed to construct insecure reqwest client")
   });
   ```

3. **Update `execute_request` in `client.rs`:**
   - Select client: `if request.skip_ssl_verification { &*INSECURE_HTTP_CLIENT } else { &*HTTP_CLIENT }`.
   - Apply timeout override: `if let Some(timeout) = request.timeout_ms { builder = builder.timeout(Duration::from_millis(timeout)); }`.

4. **Update the frontend `sendRequest` logic** to pass the new optional fields. Add `timeout_ms` and `skip_ssl_verification` to the `HttpRequestData` construction in the Zustand store's `sendRequest()`.

**Edge Cases & Gotchas:**
- **Timeout 0:** A timeout of 0ms should be treated as "no timeout" (or rejected as invalid). Enforce minimum 1000ms in the UI.
- **SSL skip scope:** The insecure client shares connection pooling independently from the secure client. This is correct behavior — insecure connections should not pollute the secure pool.
- **TypeScript bindings:** Adding optional fields to `HttpRequestData` changes the generated types. The frontend must be updated to pass these fields (can use defaults: `timeout_ms: null`, `skip_ssl_verification: false`).

**Verification:**
- Send a request to a server with a self-signed cert without SSL skip → error.
- Enable SSL skip → request succeeds.
- Set timeout to 1000ms, send request to `https://httpbin.org/delay/5` → times out after 1s.
- Set timeout to null → uses default 30s timeout.

**Depends On:** Phase 2 complete
**Blocks:** Step 6

---

### Step 6: Frontend — Request Options UI

**Objective:** Add a UI panel for per-request options: SSL certificate skip toggle and timeout configuration.

**Context:**
- Step 5 added backend support for SSL skip and timeout override.
- These options need a UI in the request builder.

**Scope:**
- Create: `src/components/request/OptionsEditor.tsx`
- Modify: `src/components/request/RequestPanel.tsx` (add Options tab or section)
- Modify: `src/stores/request-store.ts` (add options state to Tab)

**Sub-tasks:**

1. **Update Tab state in `request-store.ts`.** Add to the `Tab` interface:
   - `skipSslVerification: boolean` (default: `false`)
   - `timeoutMs: number | null` (default: `null` — uses default 30s)
   - Wire these into `sendRequest()` when constructing `HttpRequestData`.

2. **Create `src/components/request/OptionsEditor.tsx`.** A settings panel:
   - **SSL Verification:** a toggle/switch with label "Skip SSL certificate verification". When on, show a warning: "Disabling SSL verification is insecure. Use only for development with self-signed certificates." (amber/yellow warning box).
   - **Request Timeout:** a number input with label "Timeout (ms)". Placeholder: "Default (30000)". When empty/null, use the default. Minimum: 1000. Maximum: 300000 (5 minutes).
   - Layout: vertical stack of labeled form fields with descriptions.
   - Use shadcn `Switch` component for the SSL toggle.

3. **Update `RequestPanel.tsx`.** Add "Options" as a fifth tab (after Auth):
   - `<TabsTrigger value="options">Options</TabsTrigger>`
   - `<TabsContent value="options"><OptionsEditor /></TabsContent>`
   - Update `RequestTab` type to include `"options"`.

**Edge Cases & Gotchas:**
- **Timeout validation:** Validate the input is a positive integer ≥ 1000. Show inline validation error for invalid values.
- **Tab indicator:** If SSL skip is enabled or a custom timeout is set, show a small indicator dot on the "Options" tab trigger (similar to the dirty indicator on tabs) so the user knows non-default options are active.

**Verification:**
- Options tab shows SSL toggle (off) and timeout input (empty/default).
- Toggle SSL on → warning appears → send request to self-signed cert server → succeeds.
- Set timeout to 2000ms → send to slow endpoint → times out after 2s.
- Clear timeout → reverts to default 30s behavior.

**Depends On:** Step 5
**Blocks:** None

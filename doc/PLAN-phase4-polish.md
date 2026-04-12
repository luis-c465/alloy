# Alloy — Phase 4: Response & UX Polish

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Polish Alloy into a professional-quality desktop application with response body search/filter, binary response handling, import/export support (Postman collections and cURL), a comprehensive keyboard shortcut system, and light/dark theme toggling. These features complete the user experience and make Alloy competitive with established API clients.

### 1.2 — Approach Summary

This phase is primarily frontend-focused. Most features add UI capabilities that leverage the existing backend or require small backend additions:

- **Response search:** CodeMirror 6's built-in search extension, plus a JSON-path-like filter for structured responses.
- **Binary responses:** Detect binary content types on the backend, return metadata + optional base64 preview. Frontend shows image previews, hex viewer, or "save to file" prompt.
- **Import/Export:** Backend Rust parsers for Postman Collection v2.1 JSON format and cURL command generation/parsing. Frontend provides import dialogs and export menus.
- **Keyboard shortcuts:** Centralized shortcut registry in a custom hook, with a discoverable shortcut palette (Cmd+K style).
- **Theme:** CSS class toggle (`dark` class on `<html>`) persisted to local storage, with a toggle in the toolbar.

### 1.3 — Decisions Log

- **Decision:** Use CodeMirror's built-in search for response body search.
  - **Alternatives:** Custom search overlay, external search library.
  - **Rationale:** CodeMirror 6 has a built-in `@codemirror/search` extension with find/replace, regex, case sensitivity. It integrates natively with the editor already in use.

- **Decision:** JSON filtering uses a simple dot-path syntax (not full JSONPath/jq).
  - **Alternatives:** JSONPath, jq syntax, tree-based filter UI.
  - **Rationale:** A simple `path.to.field` syntax covers 90% of use cases (e.g., `data.users[0].name`) and can be implemented with a small recursive function. Full JSONPath is complex and a separate dependency.

- **Decision:** Postman Collection v2.1 JSON is the import format (not v1 or environment files).
  - **Rationale:** v2.1 is the current Postman export format and the most common. Environment import is deferred.

- **Decision:** cURL export generates a single cURL command string; cURL import parses it back.
  - **Rationale:** cURL is the universal HTTP request format. Every API developer knows it. Supporting both directions (import/export) is high value.

- **Decision:** Theme toggle is light/dark only, not custom colors.
  - **Rationale:** The shadcn design system already defines light and dark CSS variables. A toggle is trivial to implement. Custom color themes are a future enhancement.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- Phases 2 and 3 are complete.
- The app has a working sidebar, tabs, environments, history, auth presets, and multipart support.
- CodeMirror is already configured with JSON/XML/HTML language modes.

**Open Questions:**
- Should the shortcut palette (Cmd+K) also function as a command palette (search actions, open files)? (Yes, in the future — for now, just shortcuts.)
- Should binary response images be displayed inline or in a popup? (Inline as a preview in the response panel.)

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Postman collection format has undocumented quirks | Medium | Medium | Parse best-effort; skip unsupported fields; log warnings for skipped items |
| cURL parsing is complex (many flags and formats) | Medium | Medium | Support the most common flags: -X, -H, -d, --data-raw, -u, -k, --url. Ignore exotic flags with a warning. |
| Large binary responses (images, videos) cause memory issues | Low | Medium | Only preview images up to 5MB. Larger binaries show metadata + "Save to file" button. |
| Hex viewer for binary data is slow for large payloads | Low | Low | Limit hex view to first 64KB. Show "Showing first 64KB" message. |

### 1.6 — Step Sequence Overview

```
1. Response body search & JSON filter    — CodeMirror search extension, JSON dot-path filter
2. Binary response handling              — content-type detection, image preview, hex view, save-to-file
3. cURL import & export                  — cURL command parser (Rust), cURL generator, UI buttons
4. Postman collection import             — Postman JSON parser (Rust), import dialog, file creation
5. Keyboard shortcut system              — shortcut registry, shortcut palette UI, discoverable bindings
6. Theme toggle (light/dark)             — CSS class toggle, persistence, toolbar button
```

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Response Body Search & JSON Filter

**Objective:** Add full-text search within the response body viewer and a JSON dot-path filter for drilling into large JSON responses.

**Context:**
- `ResponseBody.tsx` renders the response body in a read-only CodeMirror editor.
- CodeMirror 6 has a `@codemirror/search` extension that can be enabled.
- For JSON filtering, we add a small input above the editor that accepts a path like `data.users[0].name` and shows only the matched value.

**Scope:**
- Modify: `src/components/response/ResponseBody.tsx` (add search, add filter)
- Create: `src/components/response/JsonFilter.tsx`
- Create: `src/lib/json-path.ts` (simple dot-path resolver)

**Sub-tasks:**

1. **Enable CodeMirror search extension in `ResponseBody.tsx`.** Import and add `search()` and `searchKeymap` from `@codemirror/search` to the CodeMirror extensions. This gives `Ctrl+F` / `Cmd+F` to search within the response body. The search bar appears inline within the editor (CodeMirror's default UI).

2. **Create `src/lib/json-path.ts`.** A small utility function:
   - `resolveJsonPath(obj: unknown, path: string): unknown` — resolves a dot-path against a parsed JSON object.
   - Supports: `field.nested.deep`, `array[0]`, `array[0].field`, `field[*]` (all items in array).
   - Returns the matched value, or `undefined` if path doesn't resolve.
   - Example: `resolveJsonPath({"data": {"users": [{"name": "Alice"}]}}, "data.users[0].name")` → `"Alice"`.

3. **Create `src/components/response/JsonFilter.tsx`.** A filter input displayed when the response content-type is JSON:
   - A text input with placeholder: `"Filter: e.g. data.users[0].name"`.
   - Small, appears above the CodeMirror editor in the response body tab.
   - On input change (debounced 300ms): parse the response body JSON, resolve the path, and if a match is found, replace the CodeMirror value with just the matched portion (pretty-printed).
   - A "Clear" button (X icon) resets to the full response body.
   - If the path doesn't resolve, show a subtle inline message: "No match for path."
   - If the response is not valid JSON, the filter input is hidden.

4. **Update `ResponseBody.tsx`.** Add `<JsonFilter />` above the CodeMirror editor when content type is JSON. Pass the raw body and a callback to set the displayed body value.

**Edge Cases & Gotchas:**
- **Search in filtered view:** If the user applies a JSON filter and then uses Ctrl+F, the search operates on the filtered (subset) view. This is intuitive and correct.
- **Filter and raw toggle:** Consider adding a small "Raw / Filtered" toggle. When "Raw" is selected, always show the full body regardless of filter.
- **Array indexing:** Support both `[0]` (specific index) and `[*]` (wildcard — return all items). For `[*]`, return the array with all items shown.
- **CodeMirror search keybinding:** The `searchKeymap` must be bound via `keymap.of(searchKeymap)`. Ensure it doesn't conflict with existing Ctrl+F in the app (if any).
- **Performance:** Don't re-parse JSON on every filter keystroke. Parse once and cache the parsed object. Only re-resolve the path.

**Verification:**
- Send a request that returns JSON → `Ctrl+F` opens search within the response body.
- Type `data.users[0]` in the JSON filter → only that subset is shown.
- Clear the filter → full response body restored.
- Filter with invalid path → "No match" message.
- Non-JSON response → filter input is hidden.

**Depends On:** Phases 2 & 3 complete
**Blocks:** None

---

### Step 2: Binary Response Handling

**Objective:** Detect binary responses on the backend, return appropriate metadata, and display image previews, a hex viewer, or a "save to file" prompt on the frontend.

**Context:**
- The current backend returns all response bodies as strings via `response.text().await`. Binary content produces garbled UTF-8 lossy output.
- We need to detect binary content and handle it differently.

**Scope:**
- Modify: `src-tauri/src/http/types.rs` (add binary response fields)
- Modify: `src-tauri/src/http/client.rs` (detect binary, return bytes or base64)
- Create: `src/components/response/BinaryPreview.tsx`
- Create: `src/components/response/HexViewer.tsx`
- Modify: `src/components/response/ResponseBody.tsx` (branch on binary)
- Add TauRPC procedure: `save_response_to_file` for saving binary responses

**Sub-tasks:**

1. **Update `HttpResponseData` in `types.rs`.** Add fields:
   - `is_binary: bool` — true if content type is detected as binary
   - `body_base64: Option<String>` — base64-encoded body for binary responses (only for small payloads, e.g., images <5MB). None for text responses or very large binaries.
   - `content_type: String` — the Content-Type header value for quick frontend access.

2. **Update `execute_request` in `client.rs`.** After receiving the response:
   - Extract Content-Type header.
   - Determine if binary: check if content type starts with `image/`, `audio/`, `video/`, `application/octet-stream`, `application/pdf`, `application/zip`, or any non-text type.
   - If binary:
     - Read body as bytes: `response.bytes().await`.
     - Set `is_binary: true`.
     - Set `body: ""` (empty string for the text body).
     - If size ≤ 5MB, set `body_base64: Some(base64_encode(bytes))`.
     - Set `content_type` from the header.
   - If text: existing behavior (set `body` to text, `is_binary: false`, `body_base64: None`).
   - Add `base64` crate to dependencies for encoding (or use `data_encoding` or Rust standard library's approach).

3. **Add a `save_response_to_file` TauRPC procedure.** In `commands/http.rs` or a new file:
   - Accepts: the base64 body (or re-sends the request? — simpler to use base64 from the response), a suggested filename.
   - Opens a save dialog via `tauri-plugin-dialog`.
   - Writes the decoded bytes to the selected file path.
   - Alternative: store the last binary response bytes in Rust-side state and save from there (avoids passing large base64 strings over IPC twice). Use a `Mutex<Option<Vec<u8>>>` on the resolver struct.

4. **Create `src/components/response/BinaryPreview.tsx`.** Displays binary responses:
   - If content type is `image/*` and `body_base64` exists: show the image inline using a `<img src="data:{content_type};base64,{body_base64}" />` data URI.
   - If content type is other binary: show metadata card with icon, filename guess (from URL), content type, and size.
   - "Save to File" button (download icon): triggers `save_response_to_file` procedure.
   - "View Hex" button: toggles `HexViewer`.

5. **Create `src/components/response/HexViewer.tsx`.** A simple hex dump display:
   - Takes base64 body, decodes first 64KB, displays in traditional hex format:
     ```
     00000000  48 65 6c 6c 6f 20 57 6f  72 6c 64 21 0a        |Hello World!.|
     ```
   - Use monospace font, alternating row colors.
   - If truncated: "Showing first 64 KB of {total size}".
   - This is a read-only display, no editing.

6. **Update `ResponseBody.tsx`.** Branch on `response.is_binary`:
   - If `is_binary`: render `<BinaryPreview />` instead of CodeMirror.
   - If not binary: existing CodeMirror behavior.

**Edge Cases & Gotchas:**
- **Base64 size:** A 5MB binary becomes ~6.7MB as base64. This goes over IPC (TauRPC → Tauri → frontend). For v1 this is acceptable. For larger files, consider streaming or a temp-file approach.
- **Add `base64` dependency:** Add `base64 = "0.22"` to Cargo.toml (or use the `data-encoding` crate).
- **Content-type detection:** Some APIs return binary data with misleading content types (e.g., `application/json` for a corrupted response). If text parsing fails, fall back to binary handling.
- **Image display:** Data URIs work in Tauri's webview. Large images may be slow to render. Limit inline preview to images < 2MB.
- **Save dialog integration:** The save dialog should suggest a filename based on the URL path's last segment (e.g., `/images/photo.png` → `photo.png`).

**Verification:**
- Send `GET https://httpbin.org/image/png` → response panel shows image preview.
- Click "Save to File" → save dialog opens → image saved correctly.
- Click "View Hex" → hex dump of the image bytes.
- Send request that returns JSON → normal CodeMirror view (no binary handling).

**Depends On:** Phases 2 & 3 complete
**Blocks:** None

---

### Step 3: cURL Import & Export

**Objective:** Allow users to export the current request as a cURL command and import a cURL command to create a new request tab.

**Context:**
- cURL is the universal format for sharing HTTP requests. Supporting import/export is high-value.
- Export is straightforward (construct a string). Import requires parsing cURL flags.
- Both operations benefit from Rust implementation for correctness.

**Scope:**
- Create: `src-tauri/src/import_export/mod.rs`
- Create: `src-tauri/src/import_export/curl.rs`
- Create: `src-tauri/src/commands/import_export.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add module, merge router)
- Create: `src/components/import-export/CurlImportDialog.tsx`
- Create: `src/components/import-export/CurlExportDialog.tsx`
- Modify: `src/components/layout/Toolbar.tsx` (add import/export menu)

**Sub-tasks:**

1. **Create `src-tauri/src/import_export/curl.rs`.** Two main functions:
   
   **Export: `pub fn request_to_curl(request: &HttpRequestData) -> String`**
   - Generate a cURL command string from an `HttpRequestData`.
   - Format: `curl -X METHOD 'URL' -H 'Header: Value' -d 'body'`
   - Handle:
     - Method: `-X GET`, `-X POST`, etc. (omit `-X` for GET since it's the default).
     - Headers: `-H 'Content-Type: application/json'` for each header.
     - JSON body: `-d '{"key": "value"}'` (single-quote wrapping, escape inner single quotes).
     - Form URL-encoded: `--data-urlencode 'key=value'` for each pair.
     - Raw body: `-d 'raw content'`.
     - Multipart: `-F 'key=value'` for text, `-F 'key=@filepath'` for files.
   - SSL skip: add `--insecure` / `-k` flag if `skip_ssl_verification` is true.
   - Timeout: add `--max-time {seconds}` if custom timeout is set.
   - Result should be a copy-pasteable, valid shell command.
   
   **Import: `pub fn curl_to_request(curl_command: &str) -> Result<HttpRequestData, AppError>`**
   - Parse a cURL command string into an `HttpRequestData`.
   - Support these flags:
     - `-X` / `--request` METHOD
     - `-H` / `--header` "Header: Value"
     - `-d` / `--data` / `--data-raw` / `--data-binary` BODY
     - `-F` / `--form` "key=value" or "key=@file"
     - `-u` / `--user` user:password (→ Basic auth header)
     - `-k` / `--insecure` (→ skip SSL)
     - `--max-time` SECONDS (→ timeout)
     - `--url` URL (or positional URL argument)
     - `--compressed` (ignored — reqwest handles this)
   - Strip `curl` prefix and handle line continuations (`\` at end of line).
   - Handle both single-quoted and double-quoted arguments.
   - Return `AppError::ParseError` for unparseable commands.

2. **Create `src-tauri/src/import_export/mod.rs`.** Re-export `pub mod curl;`.

3. **Create `src-tauri/src/commands/import_export.rs`.** TauRPC procedures:
   ```
   #[taurpc::procedures(path = "import_export", export_to = "../src/bindings.ts")]
   pub trait ImportExportApi {
       async fn export_curl(request: HttpRequestData) -> Result<String, AppError>;
       async fn import_curl(curl_command: String) -> Result<HttpRequestData, AppError>;
   }
   ```

4. **Update `lib.rs`.** Add `mod import_export;`, merge the new router.

5. **Create `src/components/import-export/CurlExportDialog.tsx`.** A dialog showing the generated cURL command:
   - Triggered from a "Export as cURL" button/menu item.
   - Constructs `HttpRequestData` from the active tab, calls `export_curl` procedure.
   - Shows the cURL command in a read-only CodeMirror editor (or monospace textarea) with a "Copy" button.
   - Use shadcn `Dialog`.

6. **Create `src/components/import-export/CurlImportDialog.tsx`.** A dialog for pasting a cURL command:
   - Triggered from a "Import cURL" button/menu item.
   - Textarea for pasting the cURL command.
   - "Import" button calls `import_curl` procedure.
   - On success: creates a new tab pre-filled with the parsed request.
   - On failure: shows error message inline.

7. **Update `Toolbar.tsx`.** Add an import/export dropdown menu:
   - "Import cURL" → opens CurlImportDialog
   - "Export as cURL" → opens CurlExportDialog
   - Future: "Import Postman Collection" (Step 4)

**Edge Cases & Gotchas:**
- **cURL shell escaping:** Single quotes in the body need escaping: `'` → `'\''`. For Windows compatibility, consider using double quotes with escaped inner quotes.
- **Multiline cURL:** Many cURL commands use `\` for line continuation. The parser must join these lines.
- **cURL from browser:** Chrome DevTools "Copy as cURL" uses a specific format. Test compatibility with Chrome-exported cURL commands.
- **Auth header generation:** If the request has auth presets (Bearer/Basic from Phase 3), the export should include the Authorization header. The import should detect `-u user:pass` and map it to basic auth.
- **Environment variables in export:** If the URL contains `{{variables}}`, the export should resolve them (export the concrete command) OR leave them as-is with a note. For v1: resolve variables in the export.

**Verification:**
- Export a POST request with JSON body → valid, runnable cURL command.
- Copy a cURL command from Chrome DevTools → import → tab opens with correct method, URL, headers, body.
- Round-trip: export → import → verify request matches original.
- Import malformed cURL → error message displayed.

**Depends On:** Phase 3 complete
**Blocks:** None

---

### Step 4: Postman Collection Import

**Objective:** Allow users to import Postman Collection v2.1 JSON files, converting them into a workspace directory structure with .http files.

**Context:**
- Postman exports collections as JSON files (v2.1 schema).
- We parse the JSON, extract requests, and create .http files in the workspace.
- This is a one-way import (no Postman export — users share .http files instead).

**Scope:**
- Create: `src-tauri/src/import_export/postman.rs`
- Modify: `src-tauri/src/commands/import_export.rs` (add procedure)
- Create: `src/components/import-export/PostmanImportDialog.tsx`
- Modify: `src/components/layout/Toolbar.tsx` (add to import menu)

**Sub-tasks:**

1. **Create `src-tauri/src/import_export/postman.rs`.** Postman collection parser:
   - Define Rust structs matching the Postman Collection v2.1 schema (use `serde::Deserialize`):
     - `PostmanCollection { info, item: Vec<PostmanItem>, variable }` — top-level
     - `PostmanItem` — either a folder (`item: Vec<PostmanItem>`) or a request (`request: PostmanRequest`)
     - `PostmanRequest { method, header, body, url }` — individual request
     - `PostmanUrl { raw, host, path, query }` — URL components
     - `PostmanHeader { key, value }` — header
     - `PostmanBody { mode, raw, urlencoded, formdata }` — body variants
   - `pub fn parse_postman_collection(json: &str) -> Result<PostmanCollection, AppError>` — deserialize the JSON.
   - `pub fn postman_to_workspace(collection: &PostmanCollection, workspace_path: &Path) -> Result<Vec<String>, AppError>` — converts the collection to .http files:
     - Each Postman folder becomes a subdirectory.
     - Each request becomes a `.http` file (named from the request name, sanitized).
     - Request URL, method, headers, and body are written in .http format.
     - Postman variables (`{{var}}`) are preserved as-is (they use the same syntax).
     - Postman environments are NOT imported (different file, different structure).
     - Returns a list of created file paths.

2. **Add TauRPC procedure in `import_export.rs`:**
   ```
   async fn import_postman_collection(
       json_content: String,
       workspace_path: String,
   ) -> Result<Vec<String>, AppError>;
   ```
   Also add a procedure to pick the Postman JSON file via dialog:
   ```
   async fn pick_import_file() -> Result<Option<String>, AppError>;
   ```

3. **Create `src/components/import-export/PostmanImportDialog.tsx`.** An import dialog:
   - "Select File" button that opens a file picker filtered to `.json` files.
   - Preview: after selecting, show the collection name and request count.
   - "Import" button creates the .http files in the workspace.
   - On success: show list of created files, refresh the file tree.
   - Requires an open workspace (show warning if none open).

4. **Update Toolbar.tsx import menu.** Add "Import Postman Collection" option.

**Edge Cases & Gotchas:**
- **Postman schema versions:** v2.0 and v2.1 are similar. The parser should handle both. Check for `info.schema` field to detect version.
- **Nested folders:** Postman supports deeply nested folders. Limit directory depth to prevent filesystem issues.
- **Filename sanitization:** Postman request names can contain any characters. Sanitize for filesystem: replace `/\:*?"<>|` with `-`, trim whitespace, limit length to 200 chars.
- **Duplicate names:** If two requests have the same name in the same folder, append a number suffix: `get-users.http`, `get-users-2.http`.
- **Body types:** Map Postman body modes: `raw` → Raw or JSON (check Content-Type header), `urlencoded` → FormUrlEncoded, `formdata` → Multipart, `file` → not supported (warn).
- **Auth:** Postman request-level auth should be converted to `Authorization` header or `# @auth` magic comment.

**Verification:**
- Export a Postman collection with 5 requests in 2 folders → import into workspace → 2 directories + 5 .http files created.
- Open an imported .http file → request matches the original Postman request.
- Import with nested folders → directory structure matches.
- Import with Postman variables → `{{var}}` preserved in .http files.

**Depends On:** Phase 2 (workspace file system)
**Blocks:** None

---

### Step 5: Keyboard Shortcut System

**Objective:** Implement a centralized keyboard shortcut system with a discoverable shortcut palette (Cmd+K / Ctrl+K) that lists all available actions.

**Context:**
- Phase 2 Step 12 added basic shortcuts (Ctrl+S, Ctrl+W, Ctrl+N, Ctrl+Enter).
- This step formalizes them into a registry and adds a palette UI.

**Scope:**
- Create: `src/lib/shortcuts.ts` (shortcut registry)
- Create: `src/hooks/useShortcuts.ts` (React hook for registering shortcuts)
- Create: `src/components/layout/ShortcutPalette.tsx`
- Modify: `src/App.tsx` (register shortcuts, render palette)
- Remove: existing ad-hoc keyboard handlers from Phase 2

**Sub-tasks:**

1. **Create `src/lib/shortcuts.ts`.** A shortcut registry:
   - Define a `Shortcut` type: `{ id: string, label: string, description: string, keys: string[], action: () => void, category: string }`.
   - `keys` uses format: `["Ctrl+S"]`, `["Cmd+Enter"]`, `["Ctrl+Shift+P"]`. On Mac, `Cmd` is used; on Windows/Linux, `Ctrl`.
   - Categories: "Request", "Tabs", "Navigation", "Edit", "General".
   - Export a `ShortcutRegistry` class with:
     - `register(shortcut: Shortcut)` — adds a shortcut.
     - `unregister(id: string)` — removes a shortcut.
     - `getAll(): Shortcut[]` — returns all registered shortcuts.
     - `getByCategory(): Map<string, Shortcut[]>` — grouped by category.
     - `handle(event: KeyboardEvent): boolean` — attempts to match and execute a shortcut. Returns true if handled.

2. **Create `src/hooks/useShortcuts.ts`.** A React hook:
   - Creates the global registry (singleton).
   - Registers a `keydown` listener on `window` that delegates to `registry.handle(event)`.
   - Provides `registerShortcut` and `unregisterShortcut` functions.
   - Registers the default shortcuts:
     - `Ctrl+Enter` / `Cmd+Enter` → Send request
     - `Ctrl+S` / `Cmd+S` → Save tab
     - `Ctrl+N` / `Cmd+N` → New tab
     - `Ctrl+W` / `Cmd+W` → Close tab
     - `Ctrl+Tab` → Next tab
     - `Ctrl+Shift+Tab` → Previous tab
     - `Ctrl+K` / `Cmd+K` → Open shortcut palette
     - `Ctrl+L` / `Cmd+L` → Focus URL bar
     - `Ctrl+E` / `Cmd+E` → Switch environment (cycle)
     - `Escape` → Close current dialog/palette

3. **Create `src/components/layout/ShortcutPalette.tsx`.** A searchable command palette:
   - Triggered by `Ctrl+K` / `Cmd+K`.
   - Uses shadcn `Command` component (which provides a search input + filterable list).
   - Lists all registered shortcuts grouped by category.
   - Each item shows: label, description, keyboard shortcut badge.
   - Typing filters the list.
   - Clicking or pressing Enter executes the action.
   - Escape closes the palette.
   - Style: modal overlay, similar to VS Code command palette.

4. **Update `App.tsx`.** Remove existing ad-hoc `keydown` handlers and replace with `useShortcuts()` hook. Render `<ShortcutPalette />`.

**Edge Cases & Gotchas:**
- **Platform detection:** Use `navigator.platform` to detect Mac vs Windows/Linux. Display `⌘` on Mac, `Ctrl` on others.
- **Shortcut conflicts:** Some shortcuts (Ctrl+S, Ctrl+W) may be intercepted by the browser/webview. Call `event.preventDefault()` to override.
- **Focus context:** Some shortcuts should only work when specific elements are focused (e.g., Ctrl+F for search should only work when focus is in the response panel). For v1, all shortcuts are global.
- **CodeMirror conflicts:** CodeMirror has its own keybindings (Ctrl+F for search). Ensure global shortcuts don't conflict. Give CodeMirror priority when it has focus.

**Verification:**
- `Ctrl+K` opens the shortcut palette.
- Typing "send" filters to show "Send Request (Ctrl+Enter)".
- Clicking an item executes it (e.g., clicking "New Tab" creates a tab).
- All listed shortcuts work when typed directly.
- `Escape` closes the palette.

**Depends On:** Phases 2 & 3 complete
**Blocks:** None

---

### Step 6: Theme Toggle (Light/Dark)

**Objective:** Add a light/dark mode toggle with persistent preference.

**Context:**
- The CSS already defines both light and dark theme variables (in `index.css`). Dark mode is activated by adding the `dark` class to `<html>`.
- CodeMirror uses `oneDark` theme conditionally (already implemented in `BodyEditor.tsx` and `ResponseBody.tsx`).
- Shadcn's custom variant `@custom-variant dark (&:is(.dark *))` is already configured.

**Scope:**
- Create: `src/stores/theme-store.ts`
- Create: `src/components/layout/ThemeToggle.tsx`
- Modify: `src/App.tsx` (apply theme on mount)
- Modify: `src/components/layout/Toolbar.tsx` (add toggle button)

**Sub-tasks:**

1. **Create `src/stores/theme-store.ts`.** A small Zustand store:
   - `theme: "light" | "dark" | "system"` (default: `"system"`)
   - `resolvedTheme: "light" | "dark"` — computed from `theme` and system preference.
   - `setTheme(theme)` — updates the store and applies the CSS class.
   - `initTheme()` — reads from `localStorage`, applies initial class.
   - On `setTheme`: toggle the `dark` class on `document.documentElement`, persist to `localStorage` key `"alloy-theme"`.
   - For `"system"`: listen to `window.matchMedia("(prefers-color-scheme: dark)")` and react to changes.

2. **Create `src/components/layout/ThemeToggle.tsx`.** A button in the toolbar:
   - Icon: sun (☀) for light, moon (🌙) for dark, monitor (💻) for system. Use tabler icons: `IconSun`, `IconMoon`, `IconDeviceDesktop`.
   - Click cycles through: system → light → dark → system.
   - Or use a dropdown with the three options.
   - Tooltip shows current mode.

3. **Update `App.tsx`.** Call `initTheme()` on mount to apply the persisted theme.

4. **Update `src/components/layout/Toolbar.tsx`.** Add `<ThemeToggle />` on the right side (before or after environment selector).

5. **Remove the `isDark` MutationObserver pattern** from `BodyEditor.tsx` and `ResponseBody.tsx`. Replace with reading `resolvedTheme` from the theme store. Both components currently have a `MutationObserver` on `document.documentElement.classList` — this can be replaced with a simpler Zustand subscription.

**Edge Cases & Gotchas:**
- **System preference change:** If the user selects "System" and then changes their OS theme, the app should react immediately. The `matchMedia` listener handles this.
- **localStorage availability:** `localStorage` should always be available in a Tauri webview. No need for fallback.
- **CodeMirror theme sync:** The CodeMirror theme (oneDark vs light) must sync with the app theme. Both `BodyEditor.tsx` and `ResponseBody.tsx` already conditionally apply the theme — just change them to read from the theme store instead of the MutationObserver.
- **Flash of wrong theme:** If the persisted theme is "dark" but the HTML loads as light, there's a brief flash. To prevent: apply the theme class in `index.html` via an inline `<script>` that reads localStorage before React mounts.

**Verification:**
- App launches with the system theme (or the persisted preference).
- Click theme toggle → switches between light/dark/system.
- Dark mode: all backgrounds, text, borders, CodeMirror editors update correctly.
- Close and reopen app → theme preference persisted.
- Change OS theme while "System" is selected → app theme updates.

**Depends On:** Phases 2 & 3 complete
**Blocks:** None (this is the final Phase 4 step)

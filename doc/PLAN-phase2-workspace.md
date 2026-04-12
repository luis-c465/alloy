# Alloy — Phase 2: Workspace, Collections, Environments & History

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Transform Alloy from a single-request tool into a full workspace-based API client. Users can open a project folder, browse and manage `.http` file collections in a sidebar, work on multiple requests simultaneously via tabs, define environments with variables that are substituted at send-time, and review a searchable history of all past requests stored in a local SQLite database. All data is stored in Git-friendly formats (`.http` files + TOML configs).

### 1.2 — Approach Summary

**Architecture Changes:**

The app layout shifts from a simple vertical split (request/response) to a three-column IDE-like layout:

```
┌──────────┬──────────────────────────────────────────┐
│          │  [Tab1] [Tab2] [Tab3+]   [Env: Local ▼]  │
│ Sidebar  │──────────────────────────────────────────│
│          │  Request Builder (method, url, tabs...)   │
│ - Files  │──────────────────────────────────────────│
│ - History│  Response Viewer (status, body, headers)  │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

**Key Architectural Decisions:**

- **Multi-tab state:** The Zustand store is refactored from flat single-request state to a `tabs: Tab[]` array with `activeTabId`. Each tab encapsulates its own method, URL, headers, body, response, and UI state.
- **File I/O:** All file operations happen in Rust via `tokio::fs` (no `tauri-plugin-fs` needed). Native file/folder picker dialogs use `tauri-plugin-dialog`.
- **.http parsing:** The `rest_parser` crate reads `.http` files. A custom Rust serializer writes them back. Variables (`{{var}}`) are preserved as-is in the editor and only resolved via `handlebars` at send-time.
- **Environments:** TOML files in `.alloy/environments/` define key-value variables per environment. A toolbar dropdown selects the active environment.
- **History:** `rusqlite` (bundled SQLite) stores request/response history in the Tauri app data directory. Wrapped in `tokio::sync::Mutex` for thread-safe async access from TauRPC handlers.
- **TauRPC expansion:** New procedure traits (`WorkspaceApi`, `EnvironmentApi`, `HistoryApi`) are added alongside the existing `Api` trait using TauRPC's router merge pattern.

### 1.3 — Decisions Log

- **Decision:** Use `tokio::fs` directly for all file operations, skip `tauri-plugin-fs`.
  - **Alternatives:** `tauri-plugin-fs`, `std::fs`.
  - **Rationale:** The Tauri FS plugin is for JavaScript-side file access. Since all logic runs in Rust via TauRPC, standard Rust async I/O is simpler and has no permission overhead. `tokio::fs` over `std::fs` because TauRPC handlers are async.

- **Decision:** Use `tauri-plugin-dialog` for native file/folder picker dialogs.
  - **Alternatives:** Custom file browser UI, `rfd` crate.
  - **Rationale:** Native dialogs feel right in a desktop app. `tauri-plugin-dialog` is the official Tauri v2 approach and handles cross-platform differences.

- **Decision:** Use `rusqlite` with `bundled` feature for SQLite, not `tauri-plugin-sql`.
  - **Alternatives:** `tauri-plugin-sql`, `sqlx`, flat JSON file.
  - **Rationale:** `tauri-plugin-sql` has no public Rust API — it's JS-only. `rusqlite` is mature, zero-config with `bundled`, and we control the full schema. Wrapped in `tokio::sync::Mutex` for async safety.

- **Decision:** Use TauRPC router merging with separate trait modules per domain (Workspace, Environment, History).
  - **Alternatives:** Single monolithic `Api` trait, raw Tauri commands.
  - **Rationale:** Separate traits keep the codebase modular. TauRPC's `Router::merge()` composes them cleanly. Each domain gets its own file and namespace.

- **Decision:** Tabs store full request state inline (not by reference to a file).
  - **Alternatives:** Tabs reference file paths and load on demand, centralized request cache.
  - **Rationale:** Inline state allows unsaved/new requests (no file yet), dirty tracking, and editing without auto-saving. Files are loaded into tab state on open, and written back on explicit save.

- **Decision:** Variables are resolved only at send-time, not in the editor.
  - **Alternatives:** Live preview with resolved variables, dual-mode editor.
  - **Rationale:** Users need to see and edit the `{{variable}}` placeholders. Resolving in the editor would lose the template. A small "resolved URL preview" can be shown separately.

- **Decision:** Handlebars for variable templating with non-strict mode.
  - **Alternatives:** Custom regex-based substitution, `tera` template engine.
  - **Rationale:** Handlebars matches the `{{var}}` syntax already used by VSCode REST Client and .http files. Non-strict mode renders undefined variables as empty strings, which we can enhance with a custom helper to preserve `{{undefined}}` as-is.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- A "workspace" is simply a user-selected directory on disk. There is no central project registry — users open folders directly.
- The `.alloy/` metadata directory is created automatically when a workspace is opened for the first time.
- `.http` files can exist at any depth in the workspace directory tree.
- The file tree in the sidebar shows ALL files/folders (not just `.http` files) but only `.http` files are openable as requests.
- Environment variables are flat key-value strings (no nested objects, no computed values in v1).
- History stores the full response body. For very large responses (>1MB), only the first 1MB is stored.
- A single SQLite database is shared across all workspaces (global history, not workspace-scoped).

**Open Questions:**
- Should the sidebar file tree support drag-and-drop reordering? (Deferred to Phase 4.)
- Should `.http` files with multiple requests show each request as a separate tree node, or just the file? (Start with file-level granularity; individual request expansion is a future enhancement.)
- Should environment files support importing from Postman environment exports? (Deferred to Phase 4.)

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| rest_parser doesn't handle all .http format edge cases (multipart, GraphQL, response handlers) | Medium | Medium | rest_parser covers VSCode REST Client format well. Document unsupported syntax. Add custom fallback parsing for unrecognized blocks. |
| .http file serializer loses formatting/comments on round-trip | Medium | High | Preserve original file content where possible. Only rewrite the specific request that changed, not the entire file. For v1, accept some formatting drift and improve later. |
| rusqlite blocks the Tokio runtime on large queries | Low | Medium | SQLite queries are fast for the data sizes involved. The Mutex ensures serialization. If needed, use `spawn_blocking` for heavy queries. |
| handlebars template syntax conflicts with JSON bodies containing `{{` | Medium | Medium | Handlebars processes `{{...}}` even in JSON strings. Document that literal `{{` should be escaped as `\{{`. Consider a custom delimiter or pre-processing step. |
| File watcher for external changes adds complexity | Medium | Low | Defer file watching to a future phase. For v1, reload workspace manually via a refresh button. |
| Dialog plugin blocking calls stall TauRPC | Low | High | Use `tokio::task::spawn_blocking` for all dialog calls. The research confirms this pattern works. |

### 1.6 — Step Sequence Overview

```
 1. Rust: Add Phase 2 dependencies          — Cargo.toml + plugin registration
 2. Rust: Workspace file system service     — directory listing, file read/write, .http parsing/serialization
 3. Rust: Environment system                — TOML parsing, handlebars templating, variable resolution
 4. Rust: SQLite history backend            — database schema, CRUD operations, Tauri state integration
 5. Rust: TauRPC API expansion              — new procedure traits (WorkspaceApi, EnvironmentApi, HistoryApi)
 6. Frontend: App layout restructure        — sidebar + tab bar + content area with resizable panels
 7. Frontend: Multi-tab Zustand refactor    — tabs array, active tab, tab lifecycle actions
 8. Frontend: Tab bar & workspace management— tab UI, new/close/switch tabs, open/create workspace dialogs
 9. Frontend: Sidebar collections tree      — file tree component, open file → new tab, create/delete files
10. Frontend: Sidebar history panel         — history list, search, click to re-open request
11. Frontend: Environment selector & UI     — environment dropdown, variable editor, resolved URL preview
12. Frontend: Integration & send-time variable resolution — wire variable substitution, dirty tracking, save flow
```

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Rust — Add Phase 2 Dependencies

**Objective:** Add all new Rust crate dependencies and Tauri plugins needed for Phase 2, and register the dialog plugin in the Tauri builder.

**Context:**
- The current `Cargo.toml` has: tauri 2, taurpc, specta, tokio, reqwest, thiserror, serde, serde_json.
- We need to add: `tauri-plugin-dialog`, `rusqlite`, `rest_parser`, `handlebars`, `toml`, `chrono`.
- The dialog plugin must be registered in `lib.rs`.

**Scope:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (add dialog plugin)
- Modify: `src-tauri/capabilities/default.json` (add dialog permissions)

**Sub-tasks:**

> **Updated by Step 5 executor:** In this Taurpc/Tauri combination, `AppHandle` cannot be used as an injected resolver parameter (it is treated as a deserializable IPC arg). To keep `pick_workspace_folder()` zero-argument on the frontend and still use dialogs/DB created in `.setup()`, shared runtime state is passed via `Arc<tokio::sync::OnceCell<...>>` on resolver structs (`AppHandle` for workspace + `Arc<HistoryDb>` for history/http).

> **Updated by Step 1 executor:** `rusqlite = "0.35"` and `rest_parser = "0.2"` are not published versions on crates.io. Use `rusqlite = "0.39"` and `rest_parser = "0.1"` (resolved to `0.1.7`) for a compiling setup.

1. **Add dependencies to `Cargo.toml`.** Add after the existing dependencies:
   - `tauri-plugin-dialog = "2"` — native file/folder picker dialogs
   - `rusqlite = { version = "0.39", features = ["bundled", "chrono"] }` — SQLite with bundled C library and chrono datetime support
   - `rest_parser = "0.1"` — .http/.rest file parser
   - `handlebars = "6"` — template variable substitution
   - `toml = "0.8"` — TOML parsing for environment files
   - `chrono = { version = "0.4", features = ["serde"] }` — datetime types for history timestamps
   - `uuid = { version = "1", features = ["v4"] }` — unique IDs for history records and tabs

2. **Register the dialog plugin in `lib.rs`.** In the `run()` function's `tauri::Builder`, add `.plugin(tauri_plugin_dialog::init())` after the existing opener plugin line.

3. **Update `capabilities/default.json`.** Add dialog permissions to the permissions array:
   - `"dialog:default"`
   - `"dialog:allow-open"`
   - `"dialog:allow-save"`
   - `"dialog:allow-ask"`
   - `"dialog:allow-message"`

**Edge Cases & Gotchas:**
- `rusqlite` with `bundled` feature compiles SQLite from C source. This increases build time by ~30s on first build but eliminates any system SQLite dependency.
- `rest_parser` `0.1.x` is the currently published line as of implementation. Check crates.io for updates or breaking changes.
- `chrono` feature on rusqlite enables `DateTime<Utc>` as a SQL column type.

**Verification:**
- Run `cargo check` from `src-tauri/`. All new dependencies resolve and the project compiles.
- Run `cargo build` and verify the dialog plugin initializes (check console for any plugin registration errors).

**Depends On:** None
**Blocks:** Steps 2, 3, 4, 5

---

### Step 2: Rust — Workspace File System & .http File I/O

**Objective:** Implement the Rust services for workspace directory operations, .http file parsing (via `rest_parser`), and .http file serialization (custom writer).

**Context:**
- The app needs to: open a folder as a workspace, list its file tree, read .http files into structured request data, and write requests back to .http format.
- `rest_parser` handles reading. We need a custom serializer for writing.
- All file I/O uses `tokio::fs`.

**Scope:**
- Create: `src-tauri/src/workspace/mod.rs`
- Create: `src-tauri/src/workspace/fs.rs` (directory listing, file CRUD)
- Create: `src-tauri/src/workspace/parser.rs` (.http file parsing via rest_parser)
- Create: `src-tauri/src/workspace/serializer.rs` (.http file writing)
- Create: `src-tauri/src/workspace/types.rs` (workspace-related IPC types)
- Modify: `src-tauri/src/lib.rs` (add `mod workspace;`)

**Sub-tasks:**

1. **Create `src-tauri/src/workspace/types.rs`.** Define IPC types:
   - `FileEntry { name: String, path: String, is_dir: bool, children: Option<Vec<FileEntry>> }` — recursive tree node for sidebar
   - `HttpFileRequest { name: Option<String>, method: String, url: String, headers: Vec<KeyValue>, body: Option<String>, body_type: String, commands: Vec<(String, Option<String>)> }` — a single parsed request from an .http file. Includes magic comment data.
   - `HttpFileData { path: String, requests: Vec<HttpFileRequest>, variables: Vec<KeyValue> }` — full parsed .http file with file-level variables
   - `WorkspaceInfo { path: String, name: String }` — basic workspace metadata
   
   All types should use `#[taurpc::ipc_type]` for automatic TypeScript generation.

2. **Create `src-tauri/src/workspace/fs.rs`.** Implement workspace directory operations:
   - `pub async fn list_directory(root: &Path) -> Result<Vec<FileEntry>, AppError>` — recursively lists the workspace directory tree. Skips hidden directories (starting with `.`) except `.alloy/`. Sorts directories before files, alphabetically. Only descends into directories (not symlinks). Limits depth to 10 levels to prevent infinite recursion.
   - `pub async fn ensure_alloy_dir(workspace_path: &Path) -> Result<PathBuf, AppError>` — creates `.alloy/` and `.alloy/environments/` directories if they don't exist. Returns the `.alloy/` path.
   - `pub async fn create_http_file(path: &Path) -> Result<(), AppError>` — creates a new empty .http file with a starter template:
     ```
     ### New Request
     # @name NewRequest
     GET https://example.com HTTP/1.1
     
     ```
   - `pub async fn create_directory(path: &Path) -> Result<(), AppError>` — creates a new directory.
   - `pub async fn delete_path(path: &Path) -> Result<(), AppError>` — deletes a file or empty directory. Refuses to delete non-empty directories (return error instead).
   - `pub async fn rename_path(from: &Path, to: &Path) -> Result<(), AppError>` — renames/moves a file or directory.
   - `pub async fn read_file_content(path: &Path) -> Result<String, AppError>` — reads file as UTF-8 string.

3. **Create `src-tauri/src/workspace/parser.rs`.** Implement .http file parsing:
   - `pub fn parse_http_file(content: &str, file_path: &str) -> Result<HttpFileData, AppError>` — uses `rest_parser::parse_http` (or equivalent entry point) to parse .http file content.
   - Map `rest_parser::RestRequest` to our `HttpFileRequest` type:
     - `name`: from `request.name` (set via `# @name`)
     - `method`: from `request.method.raw` (the raw template string, preserving `{{variables}}`)
     - `url`: from `request.url.raw`
     - `headers`: map `request.headers` IndexMap to `Vec<KeyValue>`, using raw template strings
     - `body`: from `request.body` — if `Body::Text(template)`, use `template.raw`. If `Body::LoadFromFile`, store as a special marker.
     - `body_type`: infer from headers — if Content-Type contains "json" → "json", if "x-www-form-urlencoded" → "form-urlencoded", else "raw"
     - `commands`: from `request.commands` — preserve for round-trip serialization
   - Map file-level variables from `rest_format.variables` to `Vec<KeyValue>` (key = variable name, value = template raw string).
   - Handle parsing errors gracefully — if rest_parser fails, return `AppError::RequestError` with context.

4. **Create `src-tauri/src/workspace/serializer.rs`.** Implement .http file writing:
   - `pub fn serialize_http_file(data: &HttpFileData) -> String` — converts structured data back to .http format string.
   - Output format for each request:
     ```
     ### [separator]
     # @name [name if present]
     [other magic comments from commands]
     [METHOD] [URL] HTTP/1.1
     [Header-Key]: [Header-Value]
     ...
     
     [body if present]
     ```
   - File-level variables are written at the top:
     ```
     @variable_name = value
     ...
     
     ```
   - Requests are separated by `###\n`.
   - Ensure proper blank line between headers and body.
   - Ensure file ends with a trailing newline.

5. **Create `src-tauri/src/workspace/mod.rs`.** Re-export all submodules:
   ```
   pub mod fs;
   pub mod parser;
   pub mod serializer;
   pub mod types;
   ```

6. **Update `src-tauri/src/lib.rs`.** Add `mod workspace;`.

7. **Add necessary `AppError` variants in `error.rs`.** Add:
   - `IoError(String)` — wraps `std::io::Error` and `tokio::io::Error`
   - `ParseError(String)` — wraps rest_parser errors
   - `SerializationError(String)` — for TOML/serialization failures
   
   Add `From<std::io::Error>` impl for AppError.

**Edge Cases & Gotchas:**
- **rest_parser API:** The crate's entry point may be `rest_parser::parse` or similar. Check the actual API before implementing. The research showed `RestFormat` with `requests` and `variables` fields.
- **Variable preservation:** rest_parser stores variables as `Template` objects with `raw` strings containing `{{var}}` syntax. Always use `.raw` to preserve the template, not the rendered value.
- **File encoding:** Assume UTF-8 for all .http files. `tokio::fs::read_to_string` will error on non-UTF-8 — catch this and return a clear error.
- **Symlinks:** `list_directory` should not follow symlinks to avoid infinite loops.
- **Large directories:** If a workspace has thousands of files, listing is slow. For v1 this is acceptable. Note as a future optimization to use lazy loading.
- **Round-trip fidelity:** The serializer will NOT preserve original formatting (comments, whitespace). It produces a canonical format. Document this limitation.
- **Multi-request files:** A single .http file can contain multiple requests separated by `###`. The parser returns all of them. The file tree shows the file; opening it creates one tab per request (or shows them in a list to pick from — implementation choice for Step 9).

**Verification:**
- Write unit tests in `parser.rs`:
  - Parse a simple .http file with one GET request → verify method, URL, headers.
  - Parse a file with multiple requests and variables → verify all requests and variables.
  - Parse a file with magic comments (`# @name`, `# @no-log`) → verify commands.
- Write unit tests in `serializer.rs`:
  - Serialize a request and parse it back → verify round-trip produces equivalent data.
- Write unit tests in `fs.rs`:
  - List a temp directory → verify FileEntry tree structure.
- `cargo test` passes from `src-tauri/`.

**Depends On:** Step 1
**Blocks:** Step 5

---

### Step 3: Rust — Environment System

**Objective:** Implement the environment management service: reading/writing TOML environment files, and resolving `{{variable}}` templates using handlebars at send-time.

**Context:**
- Environments are TOML files in `.alloy/environments/` within the workspace.
- Variables are substituted into URLs, headers, and body content at send-time using handlebars.
- The editor always shows raw `{{variable}}` templates, never resolved values.

**Scope:**
- Create: `src-tauri/src/environment/mod.rs`
- Create: `src-tauri/src/environment/types.rs`
- Create: `src-tauri/src/environment/config.rs` (TOML read/write)
- Create: `src-tauri/src/environment/resolver.rs` (handlebars variable resolution)
- Modify: `src-tauri/src/lib.rs` (add `mod environment;`)

**Sub-tasks:**

1. **Create `src-tauri/src/environment/types.rs`.** Define IPC types:
   - `EnvironmentData { name: String, variables: Vec<KeyValue> }` — an environment with its variables
   - `EnvironmentList { environments: Vec<EnvironmentData>, active: Option<String> }` — all environments + which is active
   
   Use `#[taurpc::ipc_type]`.

2. **Create `src-tauri/src/environment/config.rs`.** TOML-based environment file operations:
   - `pub async fn list_environments(workspace_path: &Path) -> Result<Vec<EnvironmentData>, AppError>` — reads all `.toml` files in `.alloy/environments/`, parses each into `EnvironmentData`. The environment name is the filename without extension (e.g., `local.toml` → "local").
   - `pub async fn read_environment(workspace_path: &Path, name: &str) -> Result<EnvironmentData, AppError>` — reads a single environment file.
   - `pub async fn write_environment(workspace_path: &Path, env: &EnvironmentData) -> Result<(), AppError>` — writes an environment to `.alloy/environments/{name}.toml`.
   - `pub async fn delete_environment(workspace_path: &Path, name: &str) -> Result<(), AppError>` — deletes an environment file.
   - `pub async fn read_active_environment(workspace_path: &Path) -> Result<Option<String>, AppError>` — reads the active environment name from `.alloy/config.toml` (field: `active_environment`).
   - `pub async fn write_active_environment(workspace_path: &Path, name: Option<&str>) -> Result<(), AppError>` — writes the active environment to `.alloy/config.toml`.
   
   TOML format for environment files:
   ```toml
   [variables]
   base_url = "http://localhost:3000"
   api_key = "dev-key-123"
   ```
   
   TOML format for `.alloy/config.toml`:
   ```toml
   active_environment = "local"
   ```

3. **Create `src-tauri/src/environment/resolver.rs`.** Handlebars-based variable resolution:
   - `pub fn create_resolver() -> Handlebars<'static>` — creates a `Handlebars` instance configured for the app:
     - Non-strict mode (undefined variables render as empty string)
     - Register a custom helper `preserve_undefined` that outputs `{{var_name}}` when a variable is undefined (instead of empty string). This is critical for showing users which variables didn't resolve.
   - `pub fn resolve_template(hbs: &Handlebars, template: &str, variables: &HashMap<String, String>) -> Result<String, AppError>` — renders a single template string against variables.
   - `pub fn resolve_request(hbs: &Handlebars, request: &HttpRequestData, variables: &HashMap<String, String>) -> Result<HttpRequestData, AppError>` — resolves all template fields in a request:
     - Resolve `request.url`
     - Resolve each header key and value
     - Resolve each query param key and value
     - Resolve body content (for Json and Raw body types)
     - Returns a new `HttpRequestData` with resolved values.

4. **Create `src-tauri/src/environment/mod.rs`.** Re-export:
   ```
   pub mod config;
   pub mod resolver;
   pub mod types;
   ```

5. **Update `lib.rs`.** Add `mod environment;`.

**Edge Cases & Gotchas:**
- **Handlebars and JSON bodies:** If a JSON body contains literal `{{` (unlikely but possible), handlebars will try to interpret it. Document that users should use `\{{` to escape. Alternatively, only resolve variables in JSON string values, not the whole body — but this is complex and handlebars doesn't support it. Accept this limitation for v1.
- **Circular variables:** If variable A references `{{B}}` and B references `{{A}}`, handlebars will not infinite-loop (it only does one pass). But the result will be partially unresolved. This is acceptable.
- **TOML parsing:** The `toml` crate deserializes into serde types. Use `toml::Value::Table` to handle the `[variables]` section flexibly (arbitrary string keys).
- **Environment name sanitization:** Environment names are used as filenames. Sanitize: lowercase, replace spaces with hyphens, strip special characters.
- **config.toml creation:** If `.alloy/config.toml` doesn't exist, `read_active_environment` should return `Ok(None)`, not error.

**Verification:**
- Unit test `resolve_template`: render `"https://{{host}}/{{path}}"` with `{"host": "localhost", "path": "api"}` → `"https://localhost/api"`.
- Unit test with undefined variable: `"{{host}}/{{undefined}}"` → verify undefined is preserved or empty based on configuration.
- Unit test TOML round-trip: write an environment, read it back, verify equality.
- `cargo test` passes.

**Depends On:** Step 1
**Blocks:** Step 5

---

### Step 4: Rust — SQLite History Backend

**Objective:** Implement the SQLite-based request history service: database initialization, recording request/response pairs, and querying history with filters.

**Context:**
- SQLite database lives in the Tauri app data directory (`app.path().app_data_dir()`).
- Uses `rusqlite` wrapped in `tokio::sync::Mutex` for async-safe access.
- History is global (not workspace-scoped).

**Scope:**
- Create: `src-tauri/src/history/mod.rs`
- Create: `src-tauri/src/history/types.rs`
- Create: `src-tauri/src/history/db.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod history;`, initialize DB in setup)

**Sub-tasks:**

1. **Create `src-tauri/src/history/types.rs`.** Define IPC types:
   - `HistoryEntry { id: i64, method: String, url: String, status: Option<u16>, status_text: Option<String>, time_ms: Option<u64>, size_bytes: Option<u64>, timestamp: String, request_headers: String, request_body: Option<String>, response_headers: Option<String>, response_body: Option<String> }` — full history record
   - `HistoryListEntry { id: i64, method: String, url: String, status: Option<u16>, time_ms: Option<u64>, timestamp: String }` — lightweight entry for the sidebar list (no bodies)
   - `HistoryFilter { query: Option<String>, method: Option<String>, status_min: Option<u16>, status_max: Option<u16>, limit: u32 }` — filter parameters for querying history
   
   Use `#[taurpc::ipc_type]`.

2. **Create `src-tauri/src/history/db.rs`.** The `HistoryDb` struct:
   - `pub struct HistoryDb { conn: tokio::sync::Mutex<rusqlite::Connection> }`
   - `pub fn new(db_path: &Path) -> Result<Self, AppError>` — opens/creates the SQLite database and runs schema initialization:
     ```sql
     CREATE TABLE IF NOT EXISTS history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       method TEXT NOT NULL,
       url TEXT NOT NULL,
       status INTEGER,
       status_text TEXT,
       time_ms INTEGER,
       size_bytes INTEGER,
       timestamp TEXT NOT NULL DEFAULT (datetime('now')),
       request_headers TEXT NOT NULL DEFAULT '[]',
       request_body TEXT,
       response_headers TEXT,
       response_body TEXT
     );
     CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
     CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
     CREATE INDEX IF NOT EXISTS idx_history_method ON history(method);
     ```
   - `pub async fn insert(&self, entry: &HistoryEntry) -> Result<i64, AppError>` — inserts a history record, returns the new ID. Truncate `response_body` to 1MB if larger.
   - `pub async fn list(&self, filter: &HistoryFilter) -> Result<Vec<HistoryListEntry>, AppError>` — queries history with filters. Default limit: 100. Builds a dynamic WHERE clause:
     - If `query` is set: `WHERE url LIKE '%query%'`
     - If `method` is set: `AND method = ?`
     - If `status_min`/`status_max` are set: `AND status BETWEEN ? AND ?`
     - `ORDER BY timestamp DESC LIMIT ?`
   - `pub async fn get(&self, id: i64) -> Result<Option<HistoryEntry>, AppError>` — gets a single full entry by ID (including bodies).
   - `pub async fn delete(&self, id: i64) -> Result<(), AppError>` — deletes a single entry.
   - `pub async fn clear(&self) -> Result<(), AppError>` — deletes all history entries.
   - `pub async fn delete_older_than_days(&self, days: u32) -> Result<u64, AppError>` — prunes old entries.

3. **Create `src-tauri/src/history/mod.rs`.** Re-export:
   ```
   pub mod db;
   pub mod types;
   ```

4. **Update `lib.rs` to initialize the database.** In the `run()` function:
   - Add a `.setup(|app| { ... })` closure (or extend existing setup).
   - In setup: get `app.path().app_data_dir()`, create the directory with `std::fs::create_dir_all`, create `HistoryDb::new(path.join("history.db"))`.
   - Store the `HistoryDb` in Tauri managed state: `app.manage(db)`.
   - The `HistoryDb` will be accessed in TauRPC handlers via the struct's own internal state (not Tauri's `State<>`, since TauRPC resolvers use `self`). Instead, store the `HistoryDb` as an `Arc` field on the resolver implementation struct.

**Edge Cases & Gotchas:**
- **Database path:** Use `app.path().app_data_dir()` which resolves to platform-specific locations (`~/.local/share/com.luisc.alloy/` on Linux, `~/Library/Application Support/com.luisc.alloy/` on macOS, `%APPDATA%\com.luisc.alloy\` on Windows).
- **First run:** The data directory may not exist. `create_dir_all` handles this.
- **Schema migrations:** For v1, use `CREATE TABLE IF NOT EXISTS`. For future schema changes, add a `schema_version` table and migration logic.
- **Response body truncation:** Large response bodies (>1MB) should be truncated before storage. Add a `TRUNCATED` marker if truncated.
- **Timestamp format:** Use ISO 8601 strings (`datetime('now')` in SQLite) for cross-platform compatibility. Convert to human-readable format on the frontend.
- **TauRPC + Tauri State integration:** TauRPC resolvers take `self`, not Tauri `State`. To access the DB from resolvers, store `Arc<HistoryDb>` as a field on the resolver impl struct, similar to how the TauRPC examples show shared state.

**Verification:**
- Unit tests:
  - Insert a history entry and retrieve it by ID → verify all fields match.
  - Insert 10 entries, list with limit 5 → verify 5 returned in reverse chronological order.
  - Filter by method "GET" → verify only GET entries returned.
  - Filter by URL pattern → verify LIKE matching works.
  - Clear all → verify empty.
- `cargo test` passes.

**Depends On:** Step 1
**Blocks:** Step 5

---

### Step 5: Rust — TauRPC API Expansion

**Objective:** Define new TauRPC procedure traits for workspace, environment, and history operations, and wire them into the router alongside the existing `Api` trait.

**Context:**
- Steps 2-4 created the backend services. Now we expose them to the frontend via TauRPC.
- The existing `Api` trait in `commands/http.rs` handles `send_request`. We add three new traits.
- TauRPC supports multiple traits merged via `Router::new().merge(...)`.
- The `send_request` procedure now needs to: (1) resolve environment variables before sending, (2) record the request/response in history after sending.

**Scope:**
- Create: `src-tauri/src/commands/workspace.rs`
- Create: `src-tauri/src/commands/environment.rs`
- Create: `src-tauri/src/commands/history.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add new modules)
- Modify: `src-tauri/src/commands/http.rs` (add env resolution + history recording)
- Modify: `src-tauri/src/lib.rs` (merge new routers, pass shared state)

**Sub-tasks:**

1. **Create `src-tauri/src/commands/workspace.rs`.** Define the workspace TauRPC trait:
   ```
   #[taurpc::procedures(path = "workspace", export_to = "../src/bindings.ts")]
   pub trait WorkspaceApi {
       async fn pick_workspace_folder() -> Result<Option<String>, AppError>;
       async fn list_files(workspace_path: String) -> Result<Vec<FileEntry>, AppError>;
       async fn read_http_file(file_path: String) -> Result<HttpFileData, AppError>;
       async fn write_http_file(file_path: String, data: HttpFileData) -> Result<(), AppError>;
       async fn create_http_file(dir_path: String, file_name: String) -> Result<String, AppError>;
       async fn create_directory(parent_path: String, dir_name: String) -> Result<String, AppError>;
       async fn delete_path(target_path: String) -> Result<(), AppError>;
       async fn rename_path(from_path: String, to_path: String) -> Result<(), AppError>;
       async fn ensure_workspace(workspace_path: String) -> Result<(), AppError>;
   }
   ```
   Implement `WorkspaceApiImpl` with `#[taurpc::resolvers]`. The struct needs an `AppHandle` field to access the dialog plugin. Use `tauri::AppHandle<impl Runtime>` or store it as `tauri::AppHandle<tauri::Wry>`.
   
   For `pick_workspace_folder`: use `tauri_plugin_dialog::DialogExt` with `tokio::task::spawn_blocking` wrapping `app.dialog().file().blocking_pick_folder()`.

2. **Create `src-tauri/src/commands/environment.rs`.** Define the environment TauRPC trait:
   ```
   #[taurpc::procedures(path = "environment", export_to = "../src/bindings.ts")]
   pub trait EnvironmentApi {
       async fn list_environments(workspace_path: String) -> Result<EnvironmentList, AppError>;
       async fn read_environment(workspace_path: String, name: String) -> Result<EnvironmentData, AppError>;
       async fn save_environment(workspace_path: String, env: EnvironmentData) -> Result<(), AppError>;
       async fn delete_environment(workspace_path: String, name: String) -> Result<(), AppError>;
       async fn set_active_environment(workspace_path: String, name: Option<String>) -> Result<(), AppError>;
       async fn resolve_url_preview(url: String, workspace_path: String, env_name: Option<String>) -> Result<String, AppError>;
   }
   ```
   Implement `EnvironmentApiImpl`. The `resolve_url_preview` procedure is for showing the user what their URL will resolve to with the current environment — called on URL change for a live preview display.

3. **Create `src-tauri/src/commands/history.rs`.** Define the history TauRPC trait:
   ```
   #[taurpc::procedures(path = "history", export_to = "../src/bindings.ts")]
   pub trait HistoryApi {
       async fn list_history(filter: HistoryFilter) -> Result<Vec<HistoryListEntry>, AppError>;
       async fn get_history_entry(id: i64) -> Result<Option<HistoryEntry>, AppError>;
       async fn delete_history_entry(id: i64) -> Result<(), AppError>;
       async fn clear_history() -> Result<(), AppError>;
   }
   ```
    Implement `HistoryApiImpl` with shared database access. If DB initialization occurs in `.setup()`, use `Arc<tokio::sync::OnceCell<Arc<HistoryDb>>>` (or equivalent) so resolvers can access the initialized DB safely.

4. **Modify `src-tauri/src/commands/http.rs`.** Update the `send_request` resolver to:
   - Accept an optional `environment_name: Option<String>` and `workspace_path: Option<String>` parameter (or add a new procedure `send_request_with_env`).
   - If environment info is provided: load the environment variables, use `resolver::resolve_request` to substitute `{{variables}}` in the request before sending.
   - After receiving the response: insert a `HistoryEntry` into the database.
    - Update the `ApiImpl` struct to hold shared DB access (`Arc<HistoryDb>` directly, or an initialized-on-setup wrapper such as `Arc<tokio::sync::OnceCell<Arc<HistoryDb>>>`) and a `Handlebars` instance.

5. **Modify `src-tauri/src/commands/mod.rs`.** Add:
   ```
   pub mod workspace;
   pub mod environment;
   pub mod history;
   ```

6. **Modify `src-tauri/src/lib.rs`.** Update the router to merge all procedure handlers:
   - Create `HistoryDb` in `.setup()` and wrap in `Arc`.
   - Create `Handlebars` resolver instance.
   - Pass shared state to each `*ApiImpl` struct.
   - Merge all handlers:
     ```
     let router = Router::new()
         .merge(ApiImpl { db: db.clone(), hbs: hbs.clone() }.into_handler())
         .merge(WorkspaceApiImpl { app_handle: app.handle().clone() }.into_handler())
         .merge(EnvironmentApiImpl.into_handler())
         .merge(HistoryApiImpl { db: db.clone() }.into_handler());
     ```
   
   Note: TauRPC's `export_to` on multiple traits writes to the same file — types are merged. All traits must use the same `export_to` path.

**Edge Cases & Gotchas:**
- **TauRPC multiple `export_to`:** When multiple traits use `export_to = "../src/bindings.ts"`, TauRPC/specta merges them into one file. If this doesn't work, use a single combined trait or manually verify the output. The `path` parameter gives each trait its own namespace in the generated TypeScript (`taurpc.workspace.list_files(...)`, `taurpc.history.list_history(...)`).
- **AppHandle in TauRPC resolvers:** TauRPC resolvers can accept `AppHandle<impl Runtime>` as a parameter in the procedure method signature (similar to `Window` or `State`). This is the cleanest way to access the dialog plugin. Alternatively, store it on the impl struct during setup.
- **Handlebars instance reuse:** Create a single `Handlebars` instance and share it via `Arc`. Handlebars is thread-safe and designed for reuse.
- **History insertion errors:** If history insert fails (DB full, corruption), log the error but don't fail the HTTP request. The response should still be returned to the user.
- **Workspace path validation:** All workspace operations should validate that the provided path exists and is a directory. Return clear errors for invalid paths.

**Verification:**
- Run `cargo build` — all new TauRPC traits compile.
- Run `bun tauri dev` — verify `bindings.ts` is regenerated with the new types and procedure namespaces.
- Inspect `bindings.ts` — verify `Router` type includes `workspace`, `environment`, and `history` namespaces.
- Manual test: call `workspace.pick_workspace_folder()` from the frontend (temp button) → native folder picker appears.

**Depends On:** Steps 2, 3, 4
**Blocks:** Steps 8, 9, 10, 11

---

### Step 6: Frontend — App Layout Restructure

> **Updated by Step 6 executor:** Installed `react-resizable-panels` v4 uses `useDefaultLayout({ id, storage })` + `onLayoutChanged` for persisted layout state. `autoSaveId`/`onLayout` are not available in this version.

**Objective:** Redesign the app layout from a simple vertical split into a three-panel IDE-like layout: a collapsible sidebar on the left, a tab bar at the top of the main content area, and the existing request/response panels in the content area.

**Context:**
- Current layout: `PanelGroup(vertical)` → `RequestPanel` / `ResponsePanel`.
- New layout: `PanelGroup(horizontal)` → `Sidebar` / `PanelGroup(vertical)` → `TabBar + RequestPanel` / `ResponsePanel`.
- The sidebar and content area should be resizable horizontally via `react-resizable-panels`.

**Scope:**
- Modify: `src/App.tsx` (new layout structure)
- Create: `src/components/layout/Sidebar.tsx` (sidebar container with tabs)
- Create: `src/components/layout/TabBar.tsx` (placeholder for Step 8)
- Create: `src/components/layout/Toolbar.tsx` (top toolbar with environment selector)
- Install additional shadcn components as needed

**Sub-tasks:**

1. **Install additional shadcn components:**
   - `bunx shadcn@latest add scroll-area` — for scrollable sidebar
   - `bunx shadcn@latest add dialog` — for workspace open/create dialogs
   - `bunx shadcn@latest add dropdown-menu` — for context menus and environment picker
   - `bunx shadcn@latest add command` — for command palette (future) and search
   - `bunx shadcn@latest add popover` — for environment variable popover

2. **Create `src/components/layout/Toolbar.tsx`.** A thin horizontal toolbar at the very top of the app:
   - Height: ~36px (`h-9`), with border-bottom
   - Left section: workspace name (or "No Workspace" if none open)
   - Right section: environment selector dropdown (placeholder for Step 11), settings gear icon
   - Style: `bg-muted/30` for subtle background differentiation

3. **Create `src/components/layout/Sidebar.tsx`.** The left panel:
   - Two tabs at the top: "Collections" (folder icon) and "History" (clock icon)
   - Use icon-only tab triggers to save space
   - Content area fills remaining height with `ScrollArea`
   - Each tab renders a placeholder div for now (Step 9 and 10 fill these in)
   - Minimum width: 200px, default width: 260px

4. **Create `src/components/layout/TabBar.tsx`.** A tab bar above the request/response area:
   - For now, render a single hardcoded tab "New Request"
   - Style: horizontal scrollable row of tabs, each ~150px max width
   - Each tab shows: colored method badge (small), request name or URL truncated
   - Close button (X) on each tab
   - "+" button at the end to create a new tab
   - Active tab has a bottom border accent
   - This is a placeholder — Step 8 wires it to the Zustand store

5. **Modify `src/App.tsx`.** Restructure the layout:
   - Outermost: `flex flex-col h-screen w-screen`
   - `<Toolbar />` at the top (fixed height)
   - Below toolbar: `PanelGroup(horizontal)` containing:
     - Left `Panel`: `<Sidebar />` (collapsible, minSize 10%, defaultSize 20%)
     - `PanelResizeHandle` (vertical)
     - Right `Panel`: inner flex-col containing:
       - `<TabBar />` (fixed height)
       - `PanelGroup(vertical)` (existing):
         - `<RequestPanel />`
         - `PanelResizeHandle` (horizontal)
         - `<ResponsePanel />`
   - The sidebar panel should use `collapsible={true}` and `collapsedSize={0}` from react-resizable-panels, with a toggle button in the toolbar.

**Edge Cases & Gotchas:**
- **Nested PanelGroups:** `react-resizable-panels` supports nesting. The outer group is horizontal (sidebar | content), the inner group is vertical (request | response). Both need unique `autoSaveId` props for persistent sizing.
- **Nested PanelGroups:** `react-resizable-panels` supports nesting. The outer group is horizontal (sidebar | content), the inner group is vertical (request | response). In v4, persist sizing with `useDefaultLayout` and unique group IDs.
- **Sidebar collapse:** When collapsed, the sidebar panel should shrink to 0. The resize handle should have a double-click to toggle collapse.
- **Responsive layout:** At very narrow widths (<800px), the sidebar should auto-collapse. In v4, use `onLayoutChanged`/resize events (there is no `onLayout` prop).
- **Tab bar overflow:** When many tabs are open, the tab bar should scroll horizontally. Use `overflow-x-auto` with `scrollbar-hide` class.

**Verification:**
- Run `bun run dev`. The app shows: toolbar at top, sidebar on left, tab bar above the request/response panels.
- The sidebar is resizable by dragging the handle.
- The sidebar can be collapsed.
- The existing request builder and response viewer still work.

**Depends On:** None (frontend-only, can parallel with Steps 1-5)
**Blocks:** Steps 7, 8, 9, 10, 11

---

### Step 7: Frontend — Multi-Tab Zustand Store Refactor

**Objective:** Refactor the Zustand store from a flat single-request model to a tab-based model where each tab holds its own independent request/response state.

**Context:**
- The current `request-store.ts` has all state at the top level (one method, one URL, one response, etc.).
- We need: `tabs: Tab[]`, `activeTabId`, and all the existing state fields moved inside each `Tab` object.
- The existing UI components (`MethodSelector`, `UrlBar`, etc.) should read from the active tab, not the store root.

**Scope:**
- Rewrite: `src/stores/request-store.ts` (complete refactor)
- Create: `src/stores/workspace-store.ts` (workspace, sidebar, environment state)
- Create: `src/hooks/useActiveTab.ts` (convenience hook for accessing active tab state)

**Sub-tasks:**

1. **Create `src/stores/workspace-store.ts`.** A new Zustand store for workspace-level state:
   - `workspacePath: string | null`
   - `workspaceName: string | null`
   - `activeEnvironment: string | null`
   - `environments: EnvironmentData[]`
   - `sidebarVisible: boolean` (default: `true`)
   - `sidebarTab: "collections" | "history"` (default: `"collections"`)
   - `fileTree: FileEntry[]` (the workspace file tree)
   - Actions: `setWorkspace`, `setSidebarVisible`, `setSidebarTab`, `setActiveEnvironment`, `setEnvironments`, `setFileTree`, `refreshFileTree` (calls backend to reload)

2. **Refactor `src/stores/request-store.ts`.** The new shape:
   - Define a `Tab` interface containing ALL per-request state:
     ```
     interface Tab {
       id: string;
       name: string;            // display name (from @name or "New Request")
       filePath: string | null;  // null if unsaved
       isDirty: boolean;
       method: string;
       url: string;
       headers: KeyValue[];
       queryParams: KeyValue[];
       bodyType: BodyType;
       bodyContent: string;
       bodyFormData: KeyValue[];
       rawContentType: string;
       response: HttpResponseData | null;
       isLoading: boolean;
       error: string | null;
       activeRequestTab: RequestTab;
       activeResponseTab: ResponseTab;
     }
     ```
   - Store shape:
     ```
     interface RequestStore {
       tabs: Tab[];
       activeTabId: string | null;
       // Tab lifecycle
       createTab(options?: Partial<Tab>): string;  // returns new tab ID
       closeTab(id: string): void;
       setActiveTab(id: string): void;
       // Active tab mutations (convenience - operate on active tab)
       updateActiveTab(patch: Partial<Tab>): void;
       // All existing setMethod/setUrl/etc. become wrappers around updateActiveTab
       setMethod(method: string): void;
       setUrl(url: string): void;
       ... (all existing setters, now scoped to active tab)
       syncQueryParamsToUrl(): void;
       syncUrlToQueryParams(): void;
       sendRequest(): Promise<void>;
       // Tab-specific
       markDirty(): void;
       markClean(): void;
       openRequestInTab(request: HttpFileRequest, filePath: string): string;
     }
     ```
   - `createTab` generates a UUID, pushes a new `Tab` with defaults, sets it as active.
   - `closeTab` removes the tab. If it was active, switch to the next tab (or previous if it was the last). If no tabs remain, create a new empty tab.
   - All setter actions (e.g., `setMethod`) find the active tab by `activeTabId` and update only that tab's field. They also set `isDirty: true`.
   - `sendRequest` reads from the active tab, sends the request, updates the active tab's response/error/loading state.
   - `openRequestInTab` creates a new tab pre-filled with data from a parsed .http file request.

3. **Create `src/hooks/useActiveTab.ts`.** A convenience hook:
   ```
   export function useActiveTab() {
     const tabs = useRequestStore(s => s.tabs);
     const activeTabId = useRequestStore(s => s.activeTabId);
     return tabs.find(t => t.id === activeTabId) ?? null;
   }
   ```
   Also create `useActiveTabField(field)` that selects a single field from the active tab to minimize re-renders.

4. **Update all existing request/response components** to use the active tab data. Since the setter functions (`setMethod`, `setUrl`, etc.) remain the same signature, most components only need minor adjustments. Components that read state directly (e.g., `useRequestStore(s => s.method)`) need to change to `useRequestStore(s => s.tabs.find(t => t.id === s.activeTabId)?.method ?? "GET")` — or use the `useActiveTab` hook.
   
   Affected components:
   - `MethodSelector.tsx` — read method from active tab
   - `UrlBar.tsx` — read url from active tab
   - `SendButton.tsx` — read isLoading from active tab
   - `ParamsEditor.tsx` — read queryParams from active tab
   - `HeadersEditor.tsx` — read headers from active tab
   - `BodyEditor.tsx` — read bodyType/bodyContent/bodyFormData from active tab
   - `ResponsePanel.tsx` — read response/error/isLoading from active tab
   - `StatusBar.tsx` — read response/isLoading/error from active tab
   - `ResponseBody.tsx` — read response from active tab
   - `ResponseHeaders.tsx` — read response from active tab

**Edge Cases & Gotchas:**
- **Performance:** With many tabs, the `tabs` array could be large. Use Zustand selectors carefully to avoid re-rendering all components when any tab changes. The `useActiveTab` hook should use `useShallow` or an equality function that only triggers when the active tab's specific field changes.
- **Tab close confirmation:** If a tab is dirty (unsaved changes), closing it should eventually prompt the user. For now, just close without prompting (add dirty-close confirmation in Step 12).
- **Race conditions:** If the user switches tabs while a request is in-flight, the response should still update the correct tab (not the newly active tab). The `sendRequest` action should capture the tab ID at invocation time and update that specific tab, not "the active tab."
- **Initial state:** On app launch, create one empty "New Request" tab.
- **Tab ID stability:** Use `crypto.randomUUID()` for tab IDs. Don't use array indices.

**Verification:**
- The app launches with one "New Request" tab.
- Creating a new tab (via the + button in TabBar) adds a tab and switches to it.
- Closing a tab removes it. The last remaining tab can't be closed (or a new empty tab is auto-created).
- Typing in one tab, switching to another, and switching back preserves state.
- Sending a request in one tab and switching to another doesn't mix up responses.

**Depends On:** Step 6
**Blocks:** Steps 8, 9, 10, 11, 12

---

### Step 8: Frontend — Tab Bar & Workspace Management

**Objective:** Wire up the tab bar UI to the multi-tab Zustand store, and implement workspace open/create dialogs.

**Context:**
- Step 6 created a placeholder `TabBar.tsx`.
- Step 7 created the multi-tab store with `createTab`, `closeTab`, `setActiveTab`.
- We also need dialogs for opening a workspace folder and creating new workspaces.

**Scope:**
- Modify: `src/components/layout/TabBar.tsx` (wire to store)
- Create: `src/components/workspace/OpenWorkspaceDialog.tsx`
- Modify: `src/components/layout/Toolbar.tsx` (add workspace open button)
- Modify: `src/lib/api.ts` (add workspace API functions)

**Sub-tasks:**

1. **Update `src/lib/api.ts`.** Add workspace API functions using the TauRPC proxy:
   - `pickWorkspaceFolder()` — calls `api.workspace.pick_workspace_folder()`
   - `listFiles(path)` — calls `api.workspace.list_files(path)`
   - `readHttpFile(path)` — calls `api.workspace.read_http_file(path)`
   - `writeHttpFile(path, data)` — calls `api.workspace.write_http_file(path, data)`
   - `createHttpFile(dirPath, fileName)` — calls `api.workspace.create_http_file(dirPath, fileName)`
   - `createDirectory(parentPath, dirName)` — calls `api.workspace.create_directory(parentPath, dirName)`
   - `deletePath(path)` — calls `api.workspace.delete_path(path)`
   - Add similar wrappers for environment and history APIs.

2. **Update `src/components/layout/TabBar.tsx`.** Wire to the Zustand store:
   - Read `tabs` and `activeTabId` from the store.
   - Render each tab as a button: show colored method dot + truncated name/URL.
   - Active tab has distinct styling (bottom border, brighter text).
   - Click on tab → `setActiveTab(id)`.
   - Close button → `closeTab(id)`. Middle-click also closes.
   - "+" button → `createTab()`.
   - Dirty indicator: show a dot/circle on tabs with `isDirty: true`.
   - Horizontal scroll if tabs overflow (use `overflow-x-auto` with `flex-nowrap`).

3. **Create `src/components/workspace/OpenWorkspaceDialog.tsx`.** When no workspace is open, show a prominent "Open Workspace" button/dialog:
   - Button in the toolbar and in the sidebar empty state.
   - Clicking calls `pickWorkspaceFolder()` from the API.
   - On folder selection: update `workspaceStore.setWorkspace(path)`, call `listFiles(path)` to populate the file tree, call `ensureWorkspace(path)` to create `.alloy/` if needed.

4. **Update `src/components/layout/Toolbar.tsx`.** Add:
   - Workspace name display (folder icon + name, extracted from path).
   - "Open Workspace" button (folder-open icon) — triggers the folder picker.
   - If workspace is already open, the button becomes a dropdown with "Open Workspace" and "Close Workspace".

**Edge Cases & Gotchas:**
- **Tab overflow:** With 20+ tabs, the tab bar scrolls. Ensure the active tab is always scrolled into view when switching tabs programmatically.
- **Tab names:** Default name is "New Request". When opened from a file, use the `# @name` value, or the filename if no name is set.
- **Method color in tab:** Reuse the same color mapping from `MethodSelector.tsx` for the colored dot/badge in each tab.
- **Workspace picker cancellation:** If the user cancels the folder picker, `pick_workspace_folder` returns `None`. Handle gracefully (no-op).
- **Cross-platform paths:** The workspace path comes from Rust as a string. Display the folder name only (last segment) in the toolbar, not the full path.

**Verification:**
- Tab bar shows all open tabs from the store.
- Clicking "+" creates a new tab and switches to it.
- Closing a tab removes it and switches to an adjacent tab.
- "Open Workspace" button triggers the native folder picker.
- After selecting a folder, the workspace name appears in the toolbar.

**Depends On:** Steps 5, 6, 7
**Blocks:** Step 9

---

### Step 9: Frontend — Sidebar Collections File Tree

**Objective:** Implement the collections tab in the sidebar, showing the workspace's file tree with the ability to open .http files as request tabs.

**Context:**
- Step 5 exposed `list_files` and `read_http_file` via TauRPC.
- Step 6 created the sidebar container.
- Step 7 created `openRequestInTab` in the store.
- Step 8 created the workspace open flow that populates `fileTree` in the workspace store.

**Scope:**
- Create: `src/components/sidebar/CollectionsPanel.tsx`
- Create: `src/components/sidebar/FileTreeNode.tsx` (recursive tree node)
- Create: `src/components/sidebar/FileTreeContextMenu.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (render CollectionsPanel in collections tab)

**Sub-tasks:**

1. **Create `src/components/sidebar/FileTreeNode.tsx`.** A recursive tree node component:
   - Props: `entry: FileEntry`, `depth: number`
   - If `is_dir`: render a collapsible folder with chevron icon, folder icon, and name. Click toggles expand/collapse. Indent children by `depth * 16px`.
   - If file (`.http` or `.rest`): render with a file icon, name, and click handler that opens the file.
   - Non-.http files: render but greyed out (not clickable) or hidden entirely.
   - Right-click: show context menu (FileTreeContextMenu).
   - Highlight the currently active file (match by `filePath` of active tab).

2. **Create `src/components/sidebar/CollectionsPanel.tsx`.** The collections tab content:
   - If no workspace is open: show empty state with "Open Workspace" button.
   - If workspace is open: render the file tree from `workspaceStore.fileTree`.
   - A toolbar at the top of the panel: "New File" button (plus icon), "New Folder" button (folder-plus icon), "Refresh" button (refresh icon).
   - "New File" creates a new `.http` file in the workspace root (or currently selected folder). Opens a small inline input for the filename.
   - "Refresh" re-fetches the file tree from the backend.
   - Click on an .http file: call `readHttpFile(path)`, then for each request in the file, call `openRequestInTab(request, filePath)`. If the file has one request, open it directly. If multiple, open the first request (or show a picker — simplest is to open all).

3. **Create `src/components/sidebar/FileTreeContextMenu.tsx`.** Right-click context menu:
   - For files: "Open", "Rename", "Delete"
   - For folders: "New File", "New Folder", "Rename", "Delete"
   - "Delete" shows a confirmation dialog (use shadcn `AlertDialog` or `dialog.message` from the backend).
   - "Rename" shows an inline editable text field on the tree node.
   - Use shadcn `DropdownMenu` for the context menu.

4. **Update `src/components/layout/Sidebar.tsx`.** Render `<CollectionsPanel />` in the "Collections" tab content area.

**Edge Cases & Gotchas:**
- **Multi-request files:** A single `.http` file can contain multiple requests. When opening, create one tab per request. Each tab's `filePath` references the same file. When saving, all requests for that file must be serialized back together.
- **File path tracking:** Store the full path and the request index within the file (e.g., `{ filePath: "/path/to/file.http", requestIndex: 0 }`). This is needed for save operations.
- **Tree expansion state:** Track which folders are expanded in component-local state (useState/useRef), not in the Zustand store. Expansion state is UI-only.
- **Large file trees:** For workspaces with hundreds of files, the tree should render efficiently. Consider using virtualization (e.g., `react-window`) for very large trees, but defer to a future optimization.
- **File name validation:** When creating new files, validate: no special characters, must end in `.http`, no duplicates in the same directory.

**Verification:**
- Open a workspace → sidebar shows the file tree with folders and .http files.
- Click an .http file → a new tab opens with the parsed request data (method, URL, headers, body pre-filled).
- Right-click a file → context menu appears with Open/Rename/Delete options.
- Create a new .http file via the toolbar → new file appears in the tree.
- Refresh button re-reads the directory.

**Depends On:** Steps 5, 6, 7, 8
**Blocks:** Step 12

---

### Step 10: Frontend — Sidebar History Panel

**Objective:** Implement the history tab in the sidebar, showing a searchable list of past requests that can be re-opened as tabs.

**Context:**
- Step 4 created the SQLite history backend.
- Step 5 exposed history via TauRPC (`list_history`, `get_history_entry`).
- Step 7 created `openRequestInTab` in the store.

**Scope:**
- Create: `src/components/sidebar/HistoryPanel.tsx`
- Create: `src/components/sidebar/HistoryListItem.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (render HistoryPanel in history tab)
- Modify: `src/lib/api.ts` (add history API functions if not done in Step 8)

**Sub-tasks:**

1. **Add history API functions to `src/lib/api.ts`:**
   - `listHistory(filter)` — calls `api.history.list_history(filter)`
   - `getHistoryEntry(id)` — calls `api.history.get_history_entry(id)`
   - `deleteHistoryEntry(id)` — calls `api.history.delete_history_entry(id)`
   - `clearHistory()` — calls `api.history.clear_history()`

2. **Create `src/components/sidebar/HistoryListItem.tsx`.** A single history entry row:
   - Shows: colored method badge (small), truncated URL, status code badge, timestamp (relative: "2m ago", "1h ago", "Yesterday").
   - Click: loads the full history entry from the backend (`getHistoryEntry(id)`), then creates a new tab pre-filled with the request data.
   - Right-click context menu: "Open", "Delete".
   - Subtle hover highlighting.

3. **Create `src/components/sidebar/HistoryPanel.tsx`.** The history tab content:
   - Search input at the top: filters by URL substring (calls `listHistory({ query })` with debounce).
   - Below search: scrollable list of `HistoryListItem` entries.
   - Method filter: optional small method pills (GET, POST, etc.) to toggle filtering.
   - "Clear All" button at the bottom (with confirmation).
   - Load more / infinite scroll: initially load 50 entries, load more on scroll to bottom.
   - Use React Query (`useQuery`) for data fetching and caching of history list. Query key: `["history", filter]`.

4. **Update `src/components/layout/Sidebar.tsx`.** Render `<HistoryPanel />` in the "History" tab.

**Edge Cases & Gotchas:**
- **Timestamp formatting:** Use relative times ("2 min ago") for recent entries and absolute dates ("Apr 12") for older ones. Compute on the frontend from the ISO timestamp string.
- **Re-opening from history:** History entries include the full request data. When opening, create a tab with `filePath: null` (history entries are not file-backed).
- **History auto-record:** The `sendRequest` flow (from Step 5 changes to `http.rs`) automatically records every sent request. The history panel should refresh after each send. Use React Query's `invalidateQueries` after `sendRequest` completes.
- **Large history:** With thousands of entries, use pagination/virtual scrolling. For v1, load 50 at a time with "load more."
- **Search debounce:** Debounce the search input by 300ms to avoid excessive backend calls.

**Verification:**
- Send a few requests → they appear in the history panel.
- Click a history entry → a new tab opens pre-filled with that request.
- Search by URL → list filters correctly.
- "Clear All" empties the history.

**Depends On:** Steps 5, 6, 7
**Blocks:** Step 12

---

### Step 11: Frontend — Environment Selector & Variable UI

**Objective:** Implement the environment selector dropdown in the toolbar and a variable management UI, plus a resolved URL preview below the URL bar.

**Context:**
- Step 3 created the environment backend (TOML + handlebars).
- Step 5 exposed environment APIs via TauRPC.
- The toolbar (Step 6) has a placeholder for the environment selector.

**Scope:**
- Create: `src/components/environment/EnvironmentSelector.tsx`
- Create: `src/components/environment/EnvironmentEditor.tsx`
- Create: `src/components/request/ResolvedUrlPreview.tsx`
- Modify: `src/components/layout/Toolbar.tsx` (render EnvironmentSelector)
- Modify: `src/components/request/RequestPanel.tsx` (add ResolvedUrlPreview)
- Modify: `src/lib/api.ts` (add environment API functions)

**Sub-tasks:**

1. **Add environment API functions to `src/lib/api.ts`:**
   - `listEnvironments(workspacePath)` — calls `api.environment.list_environments(workspacePath)`
   - `saveEnvironment(workspacePath, env)` — calls `api.environment.save_environment(workspacePath, env)`
   - `deleteEnvironment(workspacePath, name)` — calls `api.environment.delete_environment(workspacePath, name)`
   - `setActiveEnvironment(workspacePath, name)` — calls `api.environment.set_active_environment(workspacePath, name)`
   - `resolveUrlPreview(url, workspacePath, envName)` — calls `api.environment.resolve_url_preview(url, workspacePath, envName)`

2. **Create `src/components/environment/EnvironmentSelector.tsx`.** A dropdown in the toolbar:
   - Shows the active environment name (or "No Environment" if none selected).
   - Dropdown lists all available environments. Click to switch.
   - "Manage Environments" option at the bottom opens the EnvironmentEditor.
   - Disabled/hidden if no workspace is open (environments require a workspace).
   - When switching environments, update `workspaceStore.setActiveEnvironment()` and call `setActiveEnvironment` on the backend to persist.

3. **Create `src/components/environment/EnvironmentEditor.tsx`.** A dialog/modal for managing environments:
   - List of environments on the left (selectable), editor on the right.
   - Editor: key-value table (reuse `KeyValueEditor` component) for variable name/value pairs.
   - "New Environment" button: prompts for a name, creates a new TOML file.
   - "Delete" button: deletes the selected environment (with confirmation).
   - "Save" button: writes the environment to disk via `saveEnvironment`.
   - Use shadcn `Dialog` for the modal.

4. **Create `src/components/request/ResolvedUrlPreview.tsx`.** A small text display below the URL bar:
   - If the URL contains `{{variables}}` AND an environment is active: show the resolved URL in muted text.
   - Call `resolveUrlPreview(url, workspacePath, envName)` via the API with debounce (500ms).
   - If resolution fails or no variables present, hide the preview.
   - Style: small text, muted-foreground color, font-mono, with a "Resolved:" label.

5. **Update `src/components/layout/Toolbar.tsx`.** Add `<EnvironmentSelector />` on the right side.

6. **Update `src/components/request/RequestPanel.tsx`.** Add `<ResolvedUrlPreview />` between the URL bar row and the tabs.

**Edge Cases & Gotchas:**
- **No workspace = no environments.** The environment selector should be hidden or show "No Workspace" when no workspace is open.
- **Environment changes don't retroactively resolve.** Switching environments only affects future sends and the URL preview. Tab content always shows raw `{{variable}}` templates.
- **Preview debounce:** Don't call the backend on every keystroke. Debounce by 500ms. Also skip if the URL doesn't contain `{{`.
- **Environment name collisions:** When creating a new environment, validate the name is unique and filename-safe.
- **Empty environments:** An environment with no variables is valid. Selecting it means all `{{variables}}` resolve to empty strings.

**Verification:**
- With a workspace open, the environment selector shows in the toolbar.
- Creating a new environment via the editor creates a `.alloy/environments/name.toml` file.
- Selecting an environment and typing `https://{{base_url}}/api` in the URL bar shows the resolved URL preview below.
- Sending a request with an active environment resolves `{{variables}}` in the actual HTTP request.

**Depends On:** Steps 5, 6, 7, 8
**Blocks:** Step 12

---

### Step 12: Frontend — Integration, Save Flow & Polish

**Objective:** Wire together all Phase 2 features, implement the save flow (tab → .http file), integrate environment variable resolution at send-time, add dirty tracking confirmations, and polish the overall experience.

**Context:**
- All backend services and frontend components are built. This step connects them and handles the remaining integration points.

**Scope:**
- Modify: `src/stores/request-store.ts` (save flow, send-time variable resolution)
- Modify: `src/stores/workspace-store.ts` (load environments on workspace open)
- Modify: Various components for polish
- Create: `src/hooks/useKeyboardShortcuts.ts`

**Sub-tasks:**

1. **Implement the Save flow in `request-store.ts`.** Add actions:
   - `saveActiveTab()` — if `filePath` is set, serialize the tab's request data back to .http format and write to the file. If the file contains multiple requests, re-serialize all requests for that file (load other requests from their tabs or re-read the file). Set `isDirty: false`.
   - `saveActiveTabAs()` — opens a save dialog (via backend `workspace.save_dialog`), creates a new .http file, updates the tab's `filePath`.
   - For tabs with `filePath: null` (new/unsaved), `Ctrl+S` should trigger "Save As".
   - For tabs with a `filePath`, `Ctrl+S` saves directly.

2. **Integrate environment resolution at send-time.** Modify `sendRequest()` in the store:
   - Read `workspaceStore.activeEnvironment` and `workspaceStore.workspacePath`.
   - If both are set, pass them to the backend `send_request` call (which now accepts optional environment parameters from Step 5).
   - The backend handles resolution via handlebars.

3. **Implement workspace-open initialization flow in `workspace-store.ts`.**
   - When a workspace is opened (`setWorkspace`): call `listEnvironments` to populate the environment list, call `readActiveEnvironment` to restore the last active environment, call `listFiles` to populate the file tree.

4. **Add keyboard shortcuts in `src/hooks/useKeyboardShortcuts.ts`:**
   - `Ctrl+S` / `Cmd+S` → save active tab
   - `Ctrl+W` / `Cmd+W` → close active tab
   - `Ctrl+N` / `Cmd+N` → new tab
   - `Ctrl+T` / `Cmd+T` → new tab (alternative)
   - `Ctrl+Tab` → switch to next tab
   - `Ctrl+Shift+Tab` → switch to previous tab
   - `Ctrl+Enter` / `Cmd+Enter` → send request (already exists, move here)
   - Register these in `App.tsx` via the hook.

5. **Dirty tab close confirmation.** When closing a dirty tab:
   - Show a dialog: "Do you want to save changes to {name}?" with Save / Don't Save / Cancel buttons.
   - Use `tauri-plugin-dialog` message dialog from the backend, or a frontend shadcn AlertDialog.

6. **Polish and integration testing:**
   - Verify full flow: Open workspace → open .http file → edit request → send (with env vars) → response appears → save → history records the request.
   - Verify tab switching preserves all state.
   - Verify environment switching updates the URL preview.
   - Verify file tree updates after creating/deleting files.
   - Ensure no console errors or Rust panics.

**Edge Cases & Gotchas:**
- **Multi-request file saves:** If a file contains 3 requests and the user edits request #2, saving must re-serialize all 3 requests. Load request #1 and #3 from their open tabs (if any) or re-read them from disk. This is the trickiest part of the save flow.
- **File conflicts:** If the user edits a file externally while it's open in Alloy, saving could overwrite external changes. For v1, last-write-wins. File watching is a future enhancement.
- **Save dialog on app close:** When the user closes the app window with dirty tabs, Tauri should intercept the close event and prompt to save. Use Tauri's `on_close_requested` event handler.
- **Keyboard shortcut conflicts:** `Ctrl+S` might conflict with browser/webview default behavior. Call `event.preventDefault()` in the handler.

**Verification:**
- Full end-to-end workflow:
  1. Open workspace → file tree appears
  2. Click .http file → tab opens with parsed request
  3. Edit URL, add header → tab shows dirty indicator
  4. Select "Local" environment → URL preview shows resolved URL
  5. Press Ctrl+Enter → request sends with resolved variables → response appears → history records it
  6. Press Ctrl+S → file is saved → dirty indicator clears
  7. Check history tab → request appears with timestamp
  8. Close and reopen the file → edits are preserved

**Depends On:** Steps 7, 8, 9, 10, 11
**Blocks:** None (this is the final Phase 2 step)

# Alloy Performance Optimization Plan

---

## Section 1: High-Level Overview

### 1.1 — Goal Statement

This plan addresses all identified performance issues in the Alloy desktop HTTP client across both the React/TypeScript frontend and the Rust/Tauri backend. The goal is to reduce unnecessary re-renders, eliminate UI jank, optimize memory usage, reduce bundle size, and ensure the backend handles concurrent operations efficiently — resulting in a noticeably faster, more responsive application.

### 1.2 — Approach Summary

The optimization strategy targets three layers:

1. **Frontend rendering performance** — Adopt Zustand v5 best practices (`useShallow`, `subscribeWithSelector`), add `React.memo` to expensive components, implement virtualization for long lists, and lazy-load heavy libraries (CodeMirror, dialogs).

2. **Backend async & I/O performance** — Replace blocking `std::fs` calls with `spawn_blocking`, reduce SQLite lock contention, cache Handlebars templates, and optimize the response body pipeline to reduce memory allocations.

3. **Build & bundle optimization** — Add Cargo release profile settings (LTO, strip), implement Vite code splitting, conditionally load dev tools, and reduce Tokio feature surface.

**Key libraries/tools used:**
- `zustand/react/shallow` (`useShallow`) — prevents unnecessary re-renders from transformed selectors
- `@tanstack/react-virtual` — virtualizes long lists (history, file tree)
- `React.lazy` + `Suspense` — code-splits dialogs and heavy panels
- `tokio::task::spawn_blocking` — moves blocking FS operations off async threads
- Handlebars named template registration — caches compiled template ASTs

### 1.3 — Decisions Log

- **Decision:** Use `useShallow` hook instead of store splitting
  - **Alternatives considered:** Full store split into per-tab stores; `immer` middleware; `createWithEqualityFn`
  - **Rationale:** `useShallow` is the Zustand v5 recommended approach, requires minimal refactoring, and solves the re-render problem without restructuring the entire state architecture. Store splitting would be a much larger refactor with higher risk of regressions.

- **Decision:** Use `spawn_blocking` for filesystem operations instead of `tokio::fs`
  - **Alternatives considered:** `tokio::fs` (wraps spawn_blocking internally); keeping synchronous calls
  - **Rationale:** Explicit `spawn_blocking` gives more control and makes the blocking nature visible. `tokio::fs` would also work but adds a layer of indirection.

- **Decision:** Keep single Mutex for SQLite but optimize query patterns instead of adding connection pool
  - **Alternatives considered:** `deadpool-sqlite`; `r2d2`; multiple connections
  - **Rationale:** SQLite only allows one writer at a time anyway. For a desktop app with modest concurrency, the real issue is holding the lock too long (reading full response bodies), not the lock itself. Separating the list query from body retrieval solves the contention without adding a dependency.

- **Decision:** Use `React.lazy` for dialogs/modals instead of full route-based code splitting
  - **Alternatives considered:** React Router with lazy routes; manual dynamic import; no splitting
  - **Rationale:** Alloy is a single-page desktop app without routes. Dialogs and heavy panels are natural split points — they're loaded on demand and rarely all needed at once.

- **Decision:** Add `lto = "thin"` instead of `lto = true` (fat LTO)
  - **Alternatives considered:** Fat LTO (maximum optimization); no LTO
  - **Rationale:** Thin LTO provides most of the binary size and performance gains with significantly faster compile times. Fat LTO adds minutes to CI for marginal improvement.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- The project is using Zustand v5 (based on `"zustand": "5"` in package.json)
- `@tanstack/react-virtual` is compatible with the current React 19 setup
- The file tree in typical workspaces is under 1000 entries (virtualization still helps but isn't critical-path)
- History list is the primary scrollable list that benefits from virtualization

**Open Questions:**
- Should response bodies larger than 1MB be stored in history at all, or should they be truncated more aggressively at the DB level?
- Is there a measurable benefit to lazy-loading CodeMirror given it's needed on nearly every screen? (The workers are the bigger issue)
- Should the app implement response body streaming via Tauri events for very large responses in the future?

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `useShallow` causes subtle behavioral changes in selectors | Medium | Medium | Test each component after migration; `useShallow` only affects reference equality, not values |
| `React.lazy` creates flash of loading state for dialogs | Low | Low | Use `<Suspense fallback={null}>` for modals — brief delay is acceptable |
| `spawn_blocking` pool exhaustion under heavy file watching | Low | Medium | Tokio's default pool is 512 threads; desktop app won't approach this |
| Handlebars template cache grows unbounded | Low | Low | Templates are keyed by content hash; in practice, users have <100 unique templates |
| Removing Tokio features breaks a transitive dependency | Medium | High | Run `cargo check` after changes; reqwest/taurpc may depend on certain features |
| CodeMirror lazy loading causes editor flicker on first tab | Medium | Low | Preload CodeMirror chunk after initial render via `import()` prefetch |
| Immer middleware (if added later) conflicts with existing spread patterns | Low | Low | Not adding immer in this plan; staying with spread-based updates |

### 1.6 — Step Sequence Overview

1. **Add Cargo release profile optimizations** — Configure LTO, strip, codegen-units, panic=abort
2. **Reduce Tokio feature surface** — Replace `features = ["full"]` with minimal set
3. **Fix blocking filesystem operations** — Wrap `std::fs` calls in `spawn_blocking`
4. **Optimize Handlebars template resolution** — Cache compiled templates by content hash
5. **Reduce response body memory allocations** — Eliminate double-allocation in response pipeline
6. **Optimize history DB queries** — Separate list queries from body retrieval; reduce lock hold time
7. **Add Zustand `useShallow` to component selectors** — Prevent re-renders from reference inequality
8. **Add `React.memo` to expensive components** — Memoize KeyValueEditor, editor components, tab items
9. **Optimize FileTreeContext** — Split context or memoize provider value
10. **Add virtualization for long lists** — Virtualize history panel and file tree
11. **Implement code splitting with React.lazy** — Lazy-load dialogs and CodeMirror
12. **Optimize Vite build configuration** — Add manual chunks, conditional dev tools
13. **Optimize CodeMirror usage** — Stabilize extensions, defer worker loading

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Add Cargo Release Profile Optimizations

**Objective:** Configure Rust release builds for optimal binary size and runtime performance.

**Context:**
- The current `Cargo.toml` has no `[profile.release]` section
- Default Rust release builds use `opt-level = 3` but no LTO, no stripping
- This is a zero-risk change that only affects release builds

**Scope:**
- Modify: `src-tauri/Cargo.toml`

**Sub-tasks:**

1. Open `src-tauri/Cargo.toml` and add a `[profile.release]` section at the end of the file with:
   - `opt-level = 3`
   - `lto = "thin"`
   - `codegen-units = 16`
   - `strip = "symbols"`
   - `panic = "abort"`

2. Also add a `[profile.dev]` section with `opt-level = 1` to improve dev-build runtime performance (especially for the HTTP client and template resolution).

**Edge Cases & Gotchas:**
- `panic = "abort"` means panics won't unwind — any code relying on `catch_unwind` will break. Verify no usage exists with `grep -r "catch_unwind" src-tauri/`.
- Tauri's own code is compatible with `panic = "abort"`.

**Verification:**
- Run `cargo build --release` from `src-tauri/` — should compile successfully
- Binary size should decrease by 10-20% compared to before
- Run `cargo test` to ensure tests still pass (tests use the `dev` profile, not release)

**Depends On:** None
**Blocks:** None

---

### Step 2: Reduce Tokio Feature Surface

**Objective:** Replace `tokio = { features = ["full"] }` with only the features actually needed, reducing compile time and binary size.

**Context:**
- Current `Cargo.toml` uses `features = ["full"]` which includes net, process, signal, io-util, and more
- Alloy uses reqwest (has its own networking), and needs runtime + sync + fs + time
- This reduces compile time and binary size

**Scope:**
- Modify: `src-tauri/Cargo.toml`

**Sub-tasks:**

1. Search the Rust codebase for tokio feature usage:
   - `grep -r "tokio::fs" src-tauri/src/` — if found, need `"fs"` feature
   - `grep -r "tokio::time" src-tauri/src/` — if found, need `"time"` feature  
   - `grep -r "tokio::net" src-tauri/src/` — likely not needed (reqwest handles this)
   - `grep -r "tokio::process" src-tauri/src/` — likely not needed
   - `grep -r "tokio::signal" src-tauri/src/` — likely not needed
   - `grep -r "#\[tokio::main\]" src-tauri/src/` — needs `"macros"` and `"rt-multi-thread"`

2. Replace the tokio dependency line with the minimal feature set. Expected minimum:
   ```toml
   tokio = { version = "1", features = ["rt-multi-thread", "sync", "time", "macros"] }
   ```
   Add `"fs"` only if `tokio::fs` is actually used in the codebase.

3. Run `cargo check` to verify no compilation errors from missing features.

**Edge Cases & Gotchas:**
- A transitive dependency (taurpc, reqwest) might require specific tokio features. If `cargo check` fails, add back the required feature.
- `reqwest` with `rustls-tls` typically needs `tokio/net` and `tokio/io-util` — but these come through reqwest's own dependency declaration, not yours.

**Verification:**
- `cargo check` passes
- `cargo build` succeeds
- Application starts and can send HTTP requests

**Depends On:** None
**Blocks:** None (parallel with Step 1)

---

### Step 3: Fix Blocking Filesystem Operations

**Objective:** Move all blocking `std::fs` calls in async contexts to `spawn_blocking` to prevent blocking the Tokio runtime.

**Context:**
- `src-tauri/src/workspace/folder_config.rs` lines 115-128 use `std::fs::canonicalize` in an async function
- `src-tauri/src/commands/workspace.rs` lines 205-232 use `std::fs::read_dir` recursively in an async context
- These block the async executor thread, causing latency for concurrent operations

**Scope:**
- Modify: `src-tauri/src/workspace/folder_config.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Potentially modify other files found via `grep -rn "std::fs::" src-tauri/src/`

**Sub-tasks:**

1. In `workspace/folder_config.rs`, wrap the `load_folder_chain` function's blocking section in `tokio::task::spawn_blocking`:
   - Move `std::fs::canonicalize` calls into a `spawn_blocking` closure
   - The closure should return the canonicalized paths
   - Await the result and continue with async logic
   - Handle the `JoinError` from spawn_blocking by mapping it to `AppError`

2. In `commands/workspace.rs`, wrap `list_directories_recursive` in `spawn_blocking`:
   - Since the entire function is recursive with `std::fs::read_dir`, move the whole call into `spawn_blocking`
   - The function signature can remain synchronous; the caller wraps it

3. Search for any other `std::fs::` usage in async functions:
   - `grep -rn "std::fs::" src-tauri/src/` 
   - For each occurrence, check if it's called from an async context
   - Wrap in `spawn_blocking` if so

4. Ensure all `spawn_blocking` closures move owned data in (no references to local variables that would require lifetime annotations).

**Edge Cases & Gotchas:**
- `spawn_blocking` closures must be `'static` — you cannot borrow from the calling function. Clone or move `PathBuf` values into the closure.
- If `canonicalize` is called on a non-existent path, it returns an error — this behavior is preserved.
- `spawn_blocking` can return `JoinError` if the runtime is shutting down — map this to an appropriate `AppError` variant.

**Verification:**
- `cargo check` passes
- `cargo test` passes
- Open a workspace with many nested folders — sidebar should load without blocking the main request loop
- Send an HTTP request while the file tree is loading — should not block

**Depends On:** Step 2 (needs tokio features confirmed)
**Blocks:** None

---

### Step 4: Optimize Handlebars Template Resolution

**Objective:** Cache compiled Handlebars templates to avoid re-parsing on every field resolution.

**Context:**
- `src-tauri/src/environment/resolver.rs` uses `hbs.render_template(template, variables)` which re-parses the template string on every call
- A single HTTP request with URL + 10 headers + 5 query params = 16 template compilations
- Handlebars' `render(name, ctx)` method uses a cached AST when the template is pre-registered

**Scope:**
- Modify: `src-tauri/src/environment/resolver.rs`

**Sub-tasks:**

1. Change the `resolve_template` function to use template registration with caching:
   - Generate a cache key from the template string (use the string itself as key, or a hash for very long templates)
   - Before rendering, check if the template is already registered with `hbs.has_template(key)`
   - If not registered, call `hbs.register_template_string(key, template)`
   - Render using `hbs.render(key, &variables_as_json)` instead of `render_template`

2. The `Handlebars` instance needs to be mutable for registration. Evaluate whether to:
   - Option A: Use `&mut Handlebars` passed to `resolve_request` (requires changing the signature chain)
   - Option B: Use a separate `HashMap<String, ()>` to track what's registered, and re-register idempotently
   - Option C: Accept the one-time registration cost per unique template — subsequent requests with the same templates will be fast

3. Since templates in Alloy are typically short (`{{base_url}}/users`), using the template string itself as the registration name is acceptable and avoids hashing overhead.

4. Update the `resolve_request` function signature if needed to accept `&mut Handlebars` instead of `&Handlebars`.

**Edge Cases & Gotchas:**
- Template registration is not thread-safe on `Handlebars` without a lock. If `Handlebars` is shared, wrap in `RwLock<Handlebars>` or use a per-request instance with pre-registered templates.
- If the Handlebars instance grows unbounded with unique templates, consider an LRU eviction strategy. In practice, users have a limited set of templates.
- Invalid templates should still return clear errors — `register_template_string` returns `Result`.

**Verification:**
- `cargo test` passes
- Send the same request 10 times — second+ requests should resolve faster (template cached)
- Use a request with many `{{variable}}` fields — should feel snappier

**Depends On:** None
**Blocks:** None

---

### Step 5: Reduce Response Body Memory Allocations

**Objective:** Eliminate unnecessary double-allocation in the response body pipeline.

**Context:**
- `src-tauri/src/http/client.rs` lines 280-308: response body is buffered into `Vec<u8>`, then converted to `String` via `from_utf8_lossy().into_owned()` (new allocation), then optionally base64 encoded (another allocation)
- For a 10MB response, this means ~30MB peak memory usage (buffer + string + possible base64)

**Scope:**
- Modify: `src-tauri/src/http/client.rs`

**Sub-tasks:**

1. For text responses, try `String::from_utf8(buf)` first (zero-copy if valid UTF-8):
   - If it succeeds, use the resulting `String` directly (no extra allocation)
   - Only fall back to `String::from_utf8_lossy(&buf).into_owned()` if `from_utf8` fails
   - This avoids allocation for the ~99% of responses that are valid UTF-8

2. For binary responses, avoid creating an empty `String::new()` for the body field:
   - If the response is binary, set `body` to an empty string literal `""` without allocation
   - The base64 encoding is necessary for the frontend, but consider doing it only when `body_base64` is actually going to be returned (i.e., `buf.len() <= MAX_BINARY_BASE64_BYTES`)

3. Pre-allocate the buffer more accurately:
   - If `content_length` header is available, use it as capacity hint
   - If not available, start with a reasonable default (64KB instead of the current initial capacity)
   - Verify the current `Vec::with_capacity` logic and ensure it uses the content-length hint

4. For the truncation case (>50MB), stop reading chunks earlier:
   - Currently the code continues draining the response body even after truncation
   - Consider aborting the response stream once the limit is hit (call `drop` on the response) to free the connection back to the pool sooner

**Edge Cases & Gotchas:**
- `String::from_utf8` consumes the `Vec<u8>` — if it fails, you get the bytes back in the error. Use `into_bytes()` on the error to recover the buffer for the lossy conversion.
- Dropping the response stream early might cause issues with connection reuse in reqwest — test with HTTP/1.1 keep-alive connections.
- Empty string `""` in Rust is zero-allocation (static), but `String::new()` is also zero-allocation. Both are fine.

**Verification:**
- `cargo test` passes
- Send a 5MB JSON response — measure memory usage (should be ~5MB, not ~15MB)
- Send a binary file (image) — verify base64 preview still works
- Send an invalid UTF-8 response — verify it still displays (lossy fallback)

**Depends On:** None
**Blocks:** None (parallel with Steps 3, 4)

---

### Step 6: Optimize History DB Queries

**Objective:** Reduce lock hold time on the history database and avoid loading full response bodies in list queries.

**Context:**
- `src-tauri/src/history/db.rs` uses a single `Mutex<Connection>` for all operations
- The `list` endpoint selects all columns including response bodies (up to 1MB each)
- Loading 100 history entries × 1MB body each = 100MB of data loaded for a list view
- The lock is held for the entire query duration

**Scope:**
- Modify: `src-tauri/src/history/db.rs`
- Potentially modify: `src-tauri/src/history/types.rs`

**Sub-tasks:**

1. In the history `list` query (used for the sidebar history panel), exclude the `response_body` column:
   - The list view only needs: id, url, method, status_code, timestamp, duration_ms, size
   - Modify the `list` SQL query to `SELECT id, url, method, status_code, timestamp, duration_ms, size_bytes FROM history`
   - The `HistoryListEntry` type (in `types.rs`) should already be a lightweight struct without response_body — verify this

2. Ensure `response_body` is only fetched in the `get` method (when viewing a specific history entry):
   - The `get` query should `SELECT *` only for the single requested entry
   - This means the lock is held only briefly for the list query

3. Consider wrapping the SQLite operations in `spawn_blocking` to avoid holding the Mutex across async boundaries:
   - Currently, `acquire_conn()` uses `tokio::time::timeout(self.conn.lock())` 
   - The lock is a `tokio::sync::Mutex` which is async-aware, but the actual SQLite operations inside are blocking
   - Consider: acquire lock → spawn_blocking with the connection → release lock
   - OR: switch to `std::sync::Mutex` inside `spawn_blocking` for the entire operation

4. If the list query already excludes response_body (verify by reading the actual SQL), then the optimization is to ensure the `get` query is efficient:
   - Add an index on the primary key (should already exist for `id`)
   - Verify the response body column type is `TEXT` or `BLOB` — avoid unnecessary type conversions

**Edge Cases & Gotchas:**
- If `HistoryListEntry` and `HistoryEntry` are the same type, you'll need to make `response_body` an `Option<String>` that's `None` for list queries
- The DB lock timeout is set to prevent deadlocks — keep this protection
- `spawn_blocking` inside a Mutex guard requires careful ordering to avoid holding the guard across the await point

**Verification:**
- `cargo test` passes
- Open the history panel with 100+ entries — should load instantly
- Click on a specific history entry — response body should load correctly
- Send multiple concurrent requests — history saves should not block each other significantly

**Depends On:** None
**Blocks:** None (parallel with Steps 3, 4, 5)

---

### Step 7: Add Zustand `useShallow` to Component Selectors

**Objective:** Prevent unnecessary re-renders caused by reference inequality in Zustand selector outputs.

**Context:**
- Components like `TabBar`, `AuthEditor`, and others subscribe to the store with selectors that return new object/array references on every state change
- Zustand v5 recommends `useShallow` from `zustand/react/shallow` for selectors that return derived objects/arrays
- The store's `updateTabById` creates a new `tabs` array on every change, causing all `tabs`-subscribing components to re-render

**Scope:**
- Modify: `src/components/layout/TabBar.tsx`
- Modify: `src/components/request/AuthEditor.tsx`
- Modify: `src/components/request/BodyEditor.tsx`
- Modify: `src/components/request/HeadersEditor.tsx`
- Modify: `src/components/request/ParamsEditor.tsx`
- Modify: `src/components/response/ResponsePanel.tsx`
- Modify: Any other component that uses inline selectors returning objects/arrays
- Modify: `src/hooks/useActiveTab.ts` (if `selectActiveTab` returns unstable references)

**Sub-tasks:**

1. Add `import { useShallow } from "zustand/react/shallow"` to components that need it.

2. In `TabBar.tsx` (lines 28-38), wrap the tabs selector with `useShallow`:
   ```
   // Before: const tabs = useRequestStore((state) => state.tabs);
   // After:  const tabs = useRequestStore(useShallow((state) => state.tabs.map(t => ({ id: t.id, name: t.name, isDirty: t.isDirty, method: t.method, tabType: t.tabType }))));
   ```
   Only select the fields actually used for rendering tab buttons.

3. In `AuthEditor.tsx` (lines 44-49), replace the inline full-tab selector:
   - Instead of selecting the entire `activeTab` object, use `useActiveTabField` for each needed field
   - OR wrap with `useShallow` if selecting multiple fields as an object

4. In components that select action functions (setters), those are stable references and don't need `useShallow`. Only apply to selectors returning data.

5. Review `useActiveTab` hook — if it returns the full 41-property Tab object:
   - Components using the full tab object will still re-render on any tab change
   - Prefer `useActiveTabField("specificField", fallback)` in components that only need 1-2 fields

6. For components that select arrays (headers, queryParams, etc.):
   - These are fine without `useShallow` IF the array reference only changes when the array content changes (which it does in the current implementation)
   - But if the component also subscribes to other state, `useShallow` on the multi-field selector helps

**Edge Cases & Gotchas:**
- `useShallow` uses shallow equality — if a selector returns nested objects, inner changes won't trigger re-renders. Only use for flat objects or arrays of primitives/stable references.
- Don't apply `useShallow` to selectors that return a single primitive (string, number, boolean) — it's unnecessary and adds overhead.
- The `useActiveTabField` hook already handles single-field selection efficiently — prefer it over `useShallow` for single values.

**Verification:**
- Run the dev app and use React DevTools Profiler:
  - Type in the URL bar — only `UrlBar` and `ResolvedUrlPreview` should re-render, not `TabBar` or `AuthEditor`
  - Switch tabs — `TabBar` should re-render, but `BodyEditor` content shouldn't flash
- All existing functionality works correctly (send requests, switch tabs, edit headers)

**Depends On:** None
**Blocks:** Step 8 (memoization works better when parent re-renders are already reduced)

---

### Step 8: Add `React.memo` to Expensive Components

**Objective:** Prevent expensive component subtrees from re-rendering when their props haven't changed.

**Context:**
- Components like `KeyValueEditor`, `HeadersEditor`, `ParamsEditor`, and tab bar items render on every parent update
- `KeyValueEditor` renders multiple rows with inputs — expensive to re-render
- CodeMirror-based components (`CodeEditor`, `VariableInput`) are particularly expensive to re-mount

**Scope:**
- Modify: `src/components/request/KeyValueEditor.tsx`
- Modify: `src/components/request/HeadersEditor.tsx`
- Modify: `src/components/request/ParamsEditor.tsx`
- Modify: `src/components/request/BodyEditor.tsx`
- Modify: `src/components/request/AuthEditor.tsx`
- Modify: `src/components/request/OptionsEditor.tsx`
- Modify: `src/components/ui/CodeEditor.tsx`
- Modify: `src/components/layout/TabBar.tsx` (extract TabItem as memoized component)

**Sub-tasks:**

1. Wrap `KeyValueEditor` in `React.memo`:
   - Export: `export const KeyValueEditor = React.memo(function KeyValueEditor(props) { ... })`
   - Ensure `onChange` callback prop is stable (wrapped in `useCallback` by parent) — otherwise memo is ineffective

2. Wrap `HeadersEditor`, `ParamsEditor`, `AuthEditor`, `OptionsEditor` in `React.memo`:
   - These are leaf components in the request panel tabs
   - They should only re-render when their specific data changes

3. Extract individual tab button in `TabBar.tsx` into a separate memoized `TabItem` component:
   - Currently the map loop creates new handlers per iteration
   - Extract: `const TabItem = React.memo(({ tab, isActive, onActivate, onClose }) => { ... })`
   - Pass stable `onActivate` and `onClose` callbacks (use `useCallback` with the tab ID)

4. For `CodeEditor.tsx`, ensure the component is memoized and stabilize its props:
   - Wrap in `React.memo`
   - The `extensions` prop should be memoized by the parent (already done with `useMemo` in most cases)
   - The `onChange` prop must be stable — verify parents use `useCallback`

5. In `VariableInput.tsx`, fix the `keymap.of()` closure that recreates on every render:
   - Move the `onEnter` handler into a ref: `const onEnterRef = useRef(onEnter); onEnterRef.current = onEnter;`
   - Use the ref inside the keymap closure so it doesn't need to be in the dependency array

6. Ensure all `useCallback` wrappers in parents have correct dependency arrays:
   - `KeyValueEditor`'s `onChange` in `HeadersEditor` → should depend on `setHeaders`
   - Check that store action functions (like `setHeaders`) are stable references (they are in Zustand)

**Edge Cases & Gotchas:**
- `React.memo` is useless if props include unstable references (new objects/arrays/functions each render). Fix the parent first.
- Don't memo components that always receive new props — it adds comparison overhead without benefit.
- CodeMirror's `@uiw/react-codemirror` has internal memo logic — wrapping it in another memo may be redundant. Test empirically.
- `React.memo` with Zustand hooks inside the component is fine — the hook subscription still triggers re-renders when the subscribed slice changes.

**Verification:**
- React DevTools Profiler: type in URL bar → check that `KeyValueEditor` for headers does NOT re-render
- Switch between Params/Headers/Body tabs → only the active tab panel re-renders
- Edit a header value → only that row and its parent re-render, not all rows

**Depends On:** Step 7 (useShallow reduces unnecessary prop changes)
**Blocks:** None

---

### Step 9: Optimize FileTreeContext

**Objective:** Prevent the FileTreeContext from causing cascading re-renders when any single context value changes.

**Context:**
- `src/components/sidebar/FileTreeContext.tsx` provides 15+ values in a single context object
- Any change to any value (selection, expansion, renaming) causes ALL context consumers to re-render
- This affects every `FileTreeNode` in the tree

**Scope:**
- Modify: `src/components/sidebar/FileTreeContext.tsx`

**Sub-tasks:**

1. Memoize the context provider value with `useMemo`:
   - Wrap the value object in `useMemo` with appropriate dependencies
   - This prevents new object creation on unrelated parent re-renders
   ```
   const contextValue = useMemo(() => ({
     activeFilePath, selectedPath, expandedState, ...
   }), [activeFilePath, selectedPath, expandedState, ...]);
   ```

2. Split frequently-changing values from stable values:
   - **Option A (simpler):** Keep single context but memoize the value
   - **Option B (more effective):** Split into two contexts:
     - `FileTreeStateContext` — values that change rarely (handlers, workspace path, isBusy)
     - `FileTreeSelectionContext` — values that change on click (activeFilePath, selectedPath, renamingPath)
   - Recommend Option A first, move to Option B only if profiling still shows issues

3. Ensure handler functions in the context are wrapped in `useCallback`:
   - `onSelect`, `onExpand`, `onRename`, `onDelete`, etc.
   - These should not change reference unless their dependencies change

4. Consider making `FileTreeNode` subscribe directly to the store for its own `isExpanded` / `isSelected` state rather than receiving it via context.

**Edge Cases & Gotchas:**
- `useMemo` dependencies must include ALL values in the object — missing one causes stale data
- If handlers close over state that changes frequently, they'll still cause the memo to recompute. Use refs for mutable state inside handlers.
- Splitting context requires updating all `useContext(FileTreeContext)` consumers to use the correct sub-context

**Verification:**
- Expand/collapse a folder — only that node and its children should re-render, not the entire tree
- Select a file — only the previously-selected and newly-selected nodes should update
- React DevTools highlights: clicking a file should show minimal re-renders

**Depends On:** None
**Blocks:** Step 10 (virtualization is more effective with less re-rendering)

---

### Step 10: Add Virtualization for Long Lists

**Objective:** Virtualize the history panel list and file tree to only render visible items.

**Context:**
- The history panel renders all entries (up to 100+) without virtualization
- The file tree renders the entire recursive structure for large projects
- For workspaces with many files or long history, this causes measurable render time

**Scope:**
- Add dependency: `@tanstack/react-virtual`
- Modify: `src/components/sidebar/HistoryPanel.tsx`
- Potentially modify: `src/components/sidebar/CollectionsPanel.tsx` (file tree — more complex)

**Sub-tasks:**

1. Install `@tanstack/react-virtual`:
   - Run `bun add @tanstack/react-virtual`

2. Virtualize the history list in `HistoryPanel.tsx`:
   - Import `useVirtualizer` from `@tanstack/react-virtual`
   - Add a container ref to the scrollable parent element
   - Create a virtualizer instance with `count` = number of history entries and `estimateSize` = ~60px (height of each entry)
   - Replace the `.map()` rendering with the virtualizer's `getVirtualItems()` pattern
   - Apply absolute positioning with `translateY` to each visible item
   - Keep the search/filter functionality working (filter first, then virtualize filtered results)

3. For the file tree (`CollectionsPanel.tsx`), evaluate complexity:
   - File trees have variable height (nested items, expanded/collapsed sections)
   - Option A: Flatten the tree into a list (with indentation levels) and virtualize the flat list
   - Option B: Keep recursive rendering but add `React.memo` to `FileTreeNode` (simpler, Step 8 handles this)
   - **Recommend Option B for now** — file trees in HTTP client workspaces are typically <200 entries. Only implement full virtualization if profiling shows it's needed.

4. Ensure the virtualizer's parent has a fixed height (not flex-grow without bounds):
   - The history panel should have `overflow-y: auto` on a container with bounded height
   - This is likely already the case since it's in a resizable panel

**Edge Cases & Gotchas:**
- Dynamic item heights require `measureElement` from react-virtual — if history entries have variable height (multi-line URLs), use dynamic measurement
- Scrolling to a specific entry (e.g., "scroll to latest") needs `scrollToIndex` from the virtualizer
- Virtual items must be absolutely positioned within a relatively-positioned container — CSS must be adjusted
- If history entries have hover/focus state, ensure the virtualized items handle keyboard navigation

**Verification:**
- Load 500+ history entries → initial render should be under 50ms (only ~15 visible items rendered)
- Scroll the history panel → smooth 60fps scrolling without jank
- Search/filter history → results update instantly
- Click a history entry → loads correctly into a tab

**Depends On:** None
**Blocks:** None

---

### Step 11: Implement Code Splitting with React.lazy

**Objective:** Lazy-load dialog components and heavy panels to reduce initial bundle size and improve startup time.

**Context:**
- All dialogs (CurlImport, CurlExport, PostmanImport, Settings, EnvironmentEditor) are imported eagerly in `App.tsx`
- These are rarely used but add to initial bundle parse time
- CodeMirror and related worker files contribute 9.3MB to the JS bundle
- ReactQueryDevtools is loaded unconditionally

**Scope:**
- Modify: `src/App.tsx` — lazy-load import/export dialogs
- Modify: `src/components/layout/Toolbar.tsx` — lazy-load `SettingsDialog` at the actual render site
- Modify: `src/components/environment/EnvironmentSelector.tsx` — lazy-load `EnvironmentEditor` at the actual render site
- Modify: `src/main.tsx` — conditionally load ReactQueryDevtools
- Modify: `src/components/request/BodyEditor.tsx` — consider lazy CodeMirror (evaluate)
- Create: `src/components/LazyDialogs.tsx` (optional grouping file)

> **Updated by Step 11 executor:** `SettingsDialog` and `EnvironmentEditor` are rendered from `Toolbar` and `EnvironmentSelector` (not `App.tsx`) in the current codebase, so lazy-loading was applied in those files.

**Sub-tasks:**

1. In `App.tsx`, convert dialog imports to lazy:
   ```
   const CurlImportDialog = React.lazy(() => import("~/components/import-export/CurlImportDialog"));
   const CurlExportDialog = React.lazy(() => import("~/components/import-export/CurlExportDialog"));
   const PostmanImportDialog = React.lazy(() => import("~/components/import-export/PostmanImportDialog"));
   const SettingsDialog = React.lazy(() => import("~/components/layout/SettingsDialog"));
   const EnvironmentEditor = React.lazy(() => import("~/components/environment/EnvironmentEditor"));
   ```

2. Wrap lazy components in `<Suspense fallback={null}>`:
   - Dialogs don't need a loading skeleton — `null` fallback is fine since they're triggered by user action
   - The brief delay before dialog appears is acceptable

3. Ensure each dialog module has a default export:
   - If dialogs use named exports, change the lazy import:
     ```
     const CurlImportDialog = React.lazy(() => 
       import("~/components/import-export/CurlImportDialog").then(m => ({ default: m.CurlImportDialog }))
     );
     ```

4. Conditionally load ReactQueryDevtools in `main.tsx`:
   ```
   const ReactQueryDevtools = import.meta.env.DEV 
     ? React.lazy(() => import("@tanstack/react-query-devtools").then(m => ({ default: m.ReactQueryDevtools })))
     : () => null;
   ```

5. For the CodeMirror TS workers (`ts-worker-pre`, `ts-worker-post` — 3.94MB each):
   - These should only load when the scripts editor tab is opened
   - In `src/lib/codemirror/script-extensions.ts`, defer worker creation until the editor mounts
   - Use dynamic `import()` for the worker or lazy-initialize it

**Edge Cases & Gotchas:**
- `React.lazy` requires the module to have a default export (or use `.then()` adapter)
- If a dialog depends on context providers defined in `App.tsx`, ensure Suspense is placed inside those providers
- Vite automatically code-splits on dynamic `import()` — no additional config needed
- The TypeScript worker lazy-loading may require changes to how CodeMirror extensions are configured

**Verification:**
- Run `bun run build` and check `dist/assets/` — should see separate chunks for dialogs
- Initial page load should be faster (smaller main bundle to parse)
- Open each dialog — should render correctly after brief delay
- ReactQueryDevtools should NOT appear in production builds

**Depends On:** None
**Blocks:** Step 12 (manual chunks build on top of natural code splits)

---

### Step 12: Optimize Vite Build Configuration

**Objective:** Configure Vite for optimal code splitting, chunk size, and production output.

**Context:**
- Current `vite.config.ts` has `chunkSizeWarningLimit: 5000` (suppressing warnings instead of fixing)
- No `manualChunks` configuration to separate vendor code
- Total JS output is ~9.3MB (unoptimized)

**Scope:**
- Modify: `vite.config.ts`

> **Updated by Step 12 executor:** Project is on Vite 8 with Rolldown (`build.rolldownOptions`). Implemented chunk splitting via `build.rolldownOptions.output.codeSplitting.groups` instead of Rollup `manualChunks`, which is deprecated/removed in this setup.

**Sub-tasks:**

1. Add `build.rollupOptions.output.manualChunks` to split vendor code:
   ```
   manualChunks: {
     'vendor-react': ['react', 'react-dom'],
     'vendor-codemirror': ['@codemirror/lang-json', '@codemirror/lang-html', '@codemirror/lang-xml', '@codemirror/autocomplete', '@codemirror/search', '@uiw/react-codemirror'],
     'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select', ...other radix packages],
     'vendor-query': ['@tanstack/react-query'],
     'vendor-icons': ['@tabler/icons-react'],
   }
   ```

2. Lower the `chunkSizeWarningLimit` back to a reasonable value (e.g., 500KB) to catch future bloat.

3. Verify that `@tabler/icons-react` is tree-shaken:
   - Check import pattern: `import { IconSend } from "@tabler/icons-react"` ← tree-shakeable
   - vs `import * as Icons from "@tabler/icons-react"` ← NOT tree-shakeable
   - If individual imports are used, tree-shaking should work automatically

4. Consider adding `build.target: "es2022"` for modern output (Tauri's webview supports modern JS):
   - This allows smaller output by not transpiling modern syntax
   - Tauri v2 uses WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux) — all support ES2022+

5. Note: If using `rolldownOptions` (Vite 7+ with Rolldown bundler), the chunk configuration may differ from `rollupOptions`. Check which bundler is active and use the correct option name.

**Edge Cases & Gotchas:**
- `manualChunks` function must return `undefined` for chunks that should use default splitting — don't accidentally put everything in one chunk
- If the project uses Vite's Rolldown bundler (indicated by `rolldownOptions` in the current config), `manualChunks` syntax may differ — check Vite/Rolldown docs
- Over-splitting creates too many HTTP requests — but since this is a desktop app (file:// protocol or localhost), this isn't a concern
- The `@tabler/icons-react` package is known to be large even with tree-shaking — consider switching to individual icon imports from `@tabler/icons-react/dist/esm/icons/` if needed

**Verification:**
- Run `bun run build` — check `dist/assets/` for properly split chunks
- No single chunk should exceed 500KB (except maybe CodeMirror which is inherently large)
- Total bundle should decrease (better caching, tree-shaking confirmed)
- App still loads correctly after build (`bun tauri build` + run)

**Depends On:** Step 11 (lazy imports create natural split points)
**Blocks:** None

---

### Step 13: Optimize CodeMirror Usage

**Objective:** Stabilize CodeMirror editor instances to prevent unnecessary remounts and reduce extension recreation.

**Context:**
- `src/components/ui/CodeEditor.tsx` wraps `@uiw/react-codemirror`
- `src/components/ui/VariableInput.tsx` creates new keymap closures on every render
- TS workers (3.94MB each) are loaded eagerly for the scripts editor
- CodeMirror extensions arrays are recreated when their dependencies change, potentially causing editor remounts

**Scope:**
- Modify: `src/components/ui/CodeEditor.tsx`
- Modify: `src/components/ui/VariableInput.tsx`
- Modify: `src/lib/codemirror/script-extensions.ts` (worker loading)
- Modify: `src/components/request/ScriptsEditor.tsx`

> **Updated by Step 13 executor:** Added `ScriptsEditor.tsx` to scope because Sub-task 4 requires stabilizing all `extensions` arrays passed to CodeMirror, and this file had inline array literals that recreated on every render.

**Sub-tasks:**

1. In `VariableInput.tsx`, stabilize the `onEnter` callback in the keymap:
   - Store `onEnter` in a ref: `const onEnterRef = useRef(onEnter)`
   - Update the ref on each render: `onEnterRef.current = onEnter`
   - In the `useMemo` for extensions, reference `onEnterRef.current` inside the keymap handler
   - Remove `onEnter` from the `useMemo` dependency array
   - This prevents the extensions array from changing (and triggering CodeMirror reconfiguration) when the parent re-renders with a new `onEnter` function

2. In `CodeEditor.tsx`, add `React.memo` wrapper (covered in Step 8) and stabilize the `onChange` callback:
   - If `onChange` is passed as a prop, use a ref pattern similar to above
   - The `@uiw/react-codemirror` component internally handles `value` changes via transactions (not remounts) — verify this is working correctly

3. For TypeScript workers in `script-extensions.ts`:
   - Move worker creation behind a lazy initialization pattern:
     ```
     let worker: Worker | null = null;
     function getWorker() {
       if (!worker) worker = new Worker(...);
       return worker;
     }
     ```
   - Only call `getWorker()` when the scripts editor tab is first opened
   - Consider using `import()` for the worker URL to enable Vite to split it

4. Ensure the `extensions` prop to CodeMirror is referentially stable:
   - If a parent component recreates the extensions array on every render, CodeMirror will reconfigure
   - All extension arrays should be wrapped in `useMemo` with correct dependency arrays
   - Verify: `grep -rn "extensions" src/components/ | grep -v node_modules`

**Edge Cases & Gotchas:**
- CodeMirror's `basicSetup` includes many extensions — if you're also passing overlapping extensions (line numbers, bracket matching), they may conflict
- The `@uiw/react-codemirror` component does NOT remount on `value` changes (it uses a transaction). But it MAY remount on `extensions` changes — this is the key optimization target.
- Worker creation in a Vite environment requires the `?worker` import suffix or `new Worker(new URL(...), { type: 'module' })` pattern
- If the TypeScript worker provides autocomplete/diagnostics, lazy-loading means there's a delay before those features activate — this is acceptable UX

**Verification:**
- Open the app, switch between request tabs — CodeMirror editors should NOT flash/remount (check via React DevTools)
- Type in a `VariableInput` (URL bar) — the editor should not reconfigure (check console for CodeMirror warnings)
- Open the scripts editor for the first time — workers should load then (network tab)
- Scripts editor autocomplete should work after the brief initialization delay

**Depends On:** Step 8 (React.memo on CodeEditor)
**Blocks:** None

---

## Execution Order Summary

Steps can be parallelized as follows:

**Backend (independent, can run in parallel):**
- Steps 1, 2, 3, 4, 5, 6 (all backend optimizations)

**Frontend (ordered chain):**
- Step 7 → Step 8 → Step 13
- Step 9 (independent)
- Step 10 (independent)
- Step 11 → Step 12

**Recommended execution order for a single agent:**
1. Step 1 (quick, safe)
2. Step 2 (quick, safe)
3. Step 5 (medium, contained)
4. Step 6 (medium, contained)
5. Step 3 (medium, needs testing)
6. Step 4 (medium, needs testing)
7. Step 7 (frontend, broad changes)
8. Step 8 (frontend, depends on 7)
9. Step 9 (frontend, independent)
10. Step 10 (frontend, adds dependency)
11. Step 11 (frontend, code splitting)
12. Step 12 (frontend, build config)
13. Step 13 (frontend, CodeMirror)

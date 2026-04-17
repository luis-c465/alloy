/**
 * Factory for TypeScript Language Service CodeMirror extensions.
 *
 * Creates (lazily, once per script type) a Web Worker running the TS
 * virtual environment and returns the set of CodeMirror extensions that
 * wire up autocomplete, hover tooltips, and diagnostics.
 *
 * Workers are singleton per `scriptType` so multiple editor instances for
 * the same type share one worker.
 */

import { type Extension } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import * as Comlink from "comlink";
import {
  tsFacetWorker,
  tsSyncWorker,
  tsLinterWorker,
  tsAutocompleteWorker,
  tsHoverWorker,
} from "@valtown/codemirror-ts";
import type { WorkerShape } from "@valtown/codemirror-ts/worker";
import type { ScriptType } from "./alloy-types";

// Cached worker proxies — one per script type.
const workerCache = new Map<ScriptType, Comlink.Remote<WorkerShape>>();
// Cached initialised promises — prevents double-initialisation on concurrent calls.
const initPromiseCache = new Map<ScriptType, Promise<Comlink.Remote<WorkerShape>>>();

function createTsWorker(scriptType: ScriptType): Comlink.Remote<WorkerShape> {
  // Use static `new URL(...)` literals so Vite detects and bundles each
  // worker as a separate chunk in production builds.
  const raw =
    scriptType === "pre"
      ? new Worker(new URL("./ts-worker-pre.ts", import.meta.url), { type: "module" })
      : new Worker(new URL("./ts-worker-post.ts", import.meta.url), { type: "module" });
  return Comlink.wrap<WorkerShape>(raw);
}

async function getWorker(
  scriptType: ScriptType,
): Promise<Comlink.Remote<WorkerShape>> {
  const cached = workerCache.get(scriptType);
  if (cached) return cached;

  // Prevent concurrent callers from spinning up duplicate workers.
  const existing = initPromiseCache.get(scriptType);
  if (existing) return existing;

  const promise = (async () => {
    const worker = createTsWorker(scriptType);
    await worker.initialize();
    workerCache.set(scriptType, worker);
    initPromiseCache.delete(scriptType);
    return worker;
  })();

  initPromiseCache.set(scriptType, promise);
  return promise;
}

/**
 * Asynchronously build the CodeMirror extensions for a script editor.
 *
 * @param scriptType - "pre" for pre-request scripts, "post" for post-response scripts.
 * @param path       - Virtual file path used by the TS environment, e.g. "pre-request.ts".
 *                     Each editor instance should use a unique path.
 */
export async function buildScriptExtensions(
  scriptType: ScriptType,
  path: string,
): Promise<Extension[]> {
  const worker = await getWorker(scriptType);

  return [
    tsFacetWorker.of({ worker, path }),
    tsSyncWorker(),
    tsLinterWorker(),
    autocompletion({ override: [tsAutocompleteWorker()] }),
    tsHoverWorker(),
  ];
}

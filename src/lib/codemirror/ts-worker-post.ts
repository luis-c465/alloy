/**
 * Post-response TypeScript Language Service Web Worker entry point.
 * Delegates to the shared worker implementation with scriptType = "post".
 *
 * This is a separate file so that Vite can detect the static
 * `new URL('./ts-worker-post.ts', import.meta.url)` pattern and
 * bundle it as an independent worker chunk.
 */

import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import ts from "typescript";
import * as Comlink from "comlink";
import { createWorker } from "@valtown/codemirror-ts/worker";
import { tsLibFiles } from "./ts-lib-files";
import { getAlloyDeclaration } from "./alloy-types";

Comlink.expose(
  createWorker(() => {
    const fsMap = new Map(tsLibFiles);
    fsMap.set("/alloy.d.ts", getAlloyDeclaration("post"));

    const system = createSystem(fsMap);
    return createVirtualTypeScriptEnvironment(system, ["/alloy.d.ts"], ts, {
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.full.d.ts"],
      strict: false,
      noImplicitAny: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
    });
  }),
);

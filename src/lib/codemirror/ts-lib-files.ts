/**
 * Pre-bundled TypeScript standard library files for ES2022.
 *
 * These are imported as raw strings via Vite's `?raw` suffix so that the
 * TypeScript virtual file system can be built entirely offline — no CDN
 * requests are made at runtime.
 *
 * The file list is the complete transitive closure of `lib.es2022.full.d.ts`
 * references, minus the DOM libs (lib.dom.d.ts, lib.dom.iterable.d.ts,
 * lib.dom.asynciterable.d.ts) which are large and irrelevant for Boa scripts.
 */

// ES5 (base)
import libEs5 from "typescript/lib/lib.es5.d.ts?raw";

// ES2015
import libEs2015 from "typescript/lib/lib.es2015.d.ts?raw";
import libEs2015Core from "typescript/lib/lib.es2015.core.d.ts?raw";
import libEs2015Collection from "typescript/lib/lib.es2015.collection.d.ts?raw";
import libEs2015Generator from "typescript/lib/lib.es2015.generator.d.ts?raw";
import libEs2015Iterable from "typescript/lib/lib.es2015.iterable.d.ts?raw";
import libEs2015Promise from "typescript/lib/lib.es2015.promise.d.ts?raw";
import libEs2015Proxy from "typescript/lib/lib.es2015.proxy.d.ts?raw";
import libEs2015Reflect from "typescript/lib/lib.es2015.reflect.d.ts?raw";
import libEs2015Symbol from "typescript/lib/lib.es2015.symbol.d.ts?raw";
import libEs2015SymbolWellknown from "typescript/lib/lib.es2015.symbol.wellknown.d.ts?raw";

// ES2016
import libEs2016 from "typescript/lib/lib.es2016.d.ts?raw";
import libEs2016ArrayInclude from "typescript/lib/lib.es2016.array.include.d.ts?raw";
import libEs2016Intl from "typescript/lib/lib.es2016.intl.d.ts?raw";

// ES2017
import libEs2017 from "typescript/lib/lib.es2017.d.ts?raw";
import libEs2017Arraybuffer from "typescript/lib/lib.es2017.arraybuffer.d.ts?raw";
import libEs2017Date from "typescript/lib/lib.es2017.date.d.ts?raw";
import libEs2017Intl from "typescript/lib/lib.es2017.intl.d.ts?raw";
import libEs2017Object from "typescript/lib/lib.es2017.object.d.ts?raw";
import libEs2017Sharedmemory from "typescript/lib/lib.es2017.sharedmemory.d.ts?raw";
import libEs2017String from "typescript/lib/lib.es2017.string.d.ts?raw";
import libEs2017Typedarrays from "typescript/lib/lib.es2017.typedarrays.d.ts?raw";

// ES2018
import libEs2018 from "typescript/lib/lib.es2018.d.ts?raw";
import libEs2018Asyncgenerator from "typescript/lib/lib.es2018.asyncgenerator.d.ts?raw";
import libEs2018Asynciterable from "typescript/lib/lib.es2018.asynciterable.d.ts?raw";
import libEs2018Intl from "typescript/lib/lib.es2018.intl.d.ts?raw";
import libEs2018Promise from "typescript/lib/lib.es2018.promise.d.ts?raw";
import libEs2018Regexp from "typescript/lib/lib.es2018.regexp.d.ts?raw";

// ES2019
import libEs2019 from "typescript/lib/lib.es2019.d.ts?raw";
import libEs2019Array from "typescript/lib/lib.es2019.array.d.ts?raw";
import libEs2019Intl from "typescript/lib/lib.es2019.intl.d.ts?raw";
import libEs2019Object from "typescript/lib/lib.es2019.object.d.ts?raw";
import libEs2019String from "typescript/lib/lib.es2019.string.d.ts?raw";
import libEs2019Symbol from "typescript/lib/lib.es2019.symbol.d.ts?raw";

// ES2020
import libEs2020 from "typescript/lib/lib.es2020.d.ts?raw";
import libEs2020Bigint from "typescript/lib/lib.es2020.bigint.d.ts?raw";
import libEs2020Date from "typescript/lib/lib.es2020.date.d.ts?raw";
import libEs2020Intl from "typescript/lib/lib.es2020.intl.d.ts?raw";
import libEs2020Number from "typescript/lib/lib.es2020.number.d.ts?raw";
import libEs2020Promise from "typescript/lib/lib.es2020.promise.d.ts?raw";
import libEs2020Sharedmemory from "typescript/lib/lib.es2020.sharedmemory.d.ts?raw";
import libEs2020String from "typescript/lib/lib.es2020.string.d.ts?raw";
import libEs2020SymbolWellknown from "typescript/lib/lib.es2020.symbol.wellknown.d.ts?raw";

// ES2021
import libEs2021 from "typescript/lib/lib.es2021.d.ts?raw";
import libEs2021Intl from "typescript/lib/lib.es2021.intl.d.ts?raw";
import libEs2021Promise from "typescript/lib/lib.es2021.promise.d.ts?raw";
import libEs2021String from "typescript/lib/lib.es2021.string.d.ts?raw";
import libEs2021Weakref from "typescript/lib/lib.es2021.weakref.d.ts?raw";

// ES2022
import libEs2022 from "typescript/lib/lib.es2022.d.ts?raw";
import libEs2022Full from "typescript/lib/lib.es2022.full.d.ts?raw";
import libEs2022Array from "typescript/lib/lib.es2022.array.d.ts?raw";
import libEs2022Error from "typescript/lib/lib.es2022.error.d.ts?raw";
import libEs2022Intl from "typescript/lib/lib.es2022.intl.d.ts?raw";
import libEs2022Object from "typescript/lib/lib.es2022.object.d.ts?raw";
import libEs2022Regexp from "typescript/lib/lib.es2022.regexp.d.ts?raw";
import libEs2022String from "typescript/lib/lib.es2022.string.d.ts?raw";

// Host / misc
import libScripthost from "typescript/lib/lib.scripthost.d.ts?raw";
import libWebworkerImportscripts from "typescript/lib/lib.webworker.importscripts.d.ts?raw";
import libDecorators from "typescript/lib/lib.decorators.d.ts?raw";
import libDecoratorsLegacy from "typescript/lib/lib.decorators.legacy.d.ts?raw";

/**
 * A Map from virtual file path to file content for all bundled TS lib files.
 * Keys match the format expected by `@typescript/vfs` (e.g. `/lib.es5.d.ts`).
 */
export const tsLibFiles: Map<string, string> = new Map([
  ["/lib.es5.d.ts", libEs5],
  ["/lib.es2015.d.ts", libEs2015],
  ["/lib.es2015.core.d.ts", libEs2015Core],
  ["/lib.es2015.collection.d.ts", libEs2015Collection],
  ["/lib.es2015.generator.d.ts", libEs2015Generator],
  ["/lib.es2015.iterable.d.ts", libEs2015Iterable],
  ["/lib.es2015.promise.d.ts", libEs2015Promise],
  ["/lib.es2015.proxy.d.ts", libEs2015Proxy],
  ["/lib.es2015.reflect.d.ts", libEs2015Reflect],
  ["/lib.es2015.symbol.d.ts", libEs2015Symbol],
  ["/lib.es2015.symbol.wellknown.d.ts", libEs2015SymbolWellknown],
  ["/lib.es2016.d.ts", libEs2016],
  ["/lib.es2016.array.include.d.ts", libEs2016ArrayInclude],
  ["/lib.es2016.intl.d.ts", libEs2016Intl],
  ["/lib.es2017.d.ts", libEs2017],
  ["/lib.es2017.arraybuffer.d.ts", libEs2017Arraybuffer],
  ["/lib.es2017.date.d.ts", libEs2017Date],
  ["/lib.es2017.intl.d.ts", libEs2017Intl],
  ["/lib.es2017.object.d.ts", libEs2017Object],
  ["/lib.es2017.sharedmemory.d.ts", libEs2017Sharedmemory],
  ["/lib.es2017.string.d.ts", libEs2017String],
  ["/lib.es2017.typedarrays.d.ts", libEs2017Typedarrays],
  ["/lib.es2018.d.ts", libEs2018],
  ["/lib.es2018.asyncgenerator.d.ts", libEs2018Asyncgenerator],
  ["/lib.es2018.asynciterable.d.ts", libEs2018Asynciterable],
  ["/lib.es2018.intl.d.ts", libEs2018Intl],
  ["/lib.es2018.promise.d.ts", libEs2018Promise],
  ["/lib.es2018.regexp.d.ts", libEs2018Regexp],
  ["/lib.es2019.d.ts", libEs2019],
  ["/lib.es2019.array.d.ts", libEs2019Array],
  ["/lib.es2019.intl.d.ts", libEs2019Intl],
  ["/lib.es2019.object.d.ts", libEs2019Object],
  ["/lib.es2019.string.d.ts", libEs2019String],
  ["/lib.es2019.symbol.d.ts", libEs2019Symbol],
  ["/lib.es2020.d.ts", libEs2020],
  ["/lib.es2020.bigint.d.ts", libEs2020Bigint],
  ["/lib.es2020.date.d.ts", libEs2020Date],
  ["/lib.es2020.intl.d.ts", libEs2020Intl],
  ["/lib.es2020.number.d.ts", libEs2020Number],
  ["/lib.es2020.promise.d.ts", libEs2020Promise],
  ["/lib.es2020.sharedmemory.d.ts", libEs2020Sharedmemory],
  ["/lib.es2020.string.d.ts", libEs2020String],
  ["/lib.es2020.symbol.wellknown.d.ts", libEs2020SymbolWellknown],
  ["/lib.es2021.d.ts", libEs2021],
  ["/lib.es2021.intl.d.ts", libEs2021Intl],
  ["/lib.es2021.promise.d.ts", libEs2021Promise],
  ["/lib.es2021.string.d.ts", libEs2021String],
  ["/lib.es2021.weakref.d.ts", libEs2021Weakref],
  ["/lib.es2022.d.ts", libEs2022],
  ["/lib.es2022.full.d.ts", libEs2022Full],
  ["/lib.es2022.array.d.ts", libEs2022Array],
  ["/lib.es2022.error.d.ts", libEs2022Error],
  ["/lib.es2022.intl.d.ts", libEs2022Intl],
  ["/lib.es2022.object.d.ts", libEs2022Object],
  ["/lib.es2022.regexp.d.ts", libEs2022Regexp],
  ["/lib.es2022.string.d.ts", libEs2022String],
  ["/lib.scripthost.d.ts", libScripthost],
  ["/lib.webworker.importscripts.d.ts", libWebworkerImportscripts],
  ["/lib.decorators.d.ts", libDecorators],
  ["/lib.decorators.legacy.d.ts", libDecoratorsLegacy],
]);

import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { search, searchKeymap } from "@codemirror/search";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

import { JsonFilter } from "~/components/response/JsonFilter";
import { useActiveTabField } from "~/hooks/useActiveTab";

const MAX_PREVIEW_BYTES = 1024 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(1)} MB`;
};

const getContentType = (
  headers: Array<{ key: string; value: string }> | undefined,
): string => {
  if (!headers) {
    return "";
  }

  const match = headers.find(
    (header) => header.key.toLowerCase() === "content-type",
  );
  return match?.value.toLowerCase() ?? "";
};

export function ResponseBody() {
  const response = useActiveTabField("response", null);
  const [isDark, setIsDark] = useState(false);
  const [displayBody, setDisplayBody] = useState("");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const contentType = useMemo(() => getContentType(response?.headers), [response]);
  const body = response?.body ?? "";
  const bodyBytes = useMemo(() => new Blob([body]).size, [body]);
  const isTruncated = bodyBytes > MAX_PREVIEW_BYTES;
  const previewBody = isTruncated ? body.slice(0, MAX_PREVIEW_BYTES) : body;
  const isJsonContent = contentType.includes("application/json");

  const parsedJsonBody = useMemo(() => {
    if (!isJsonContent) {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }, [body, isJsonContent]);

  const rawDisplayBody = useMemo(() => {
    if (!isJsonContent) {
      return previewBody;
    }

    if (!parsedJsonBody) {
      return previewBody;
    }

    return JSON.stringify(parsedJsonBody, null, 2);
  }, [isJsonContent, parsedJsonBody, previewBody]);

  useEffect(() => {
    setDisplayBody(rawDisplayBody);
  }, [rawDisplayBody]);

  const extensions = useMemo(() => {
    const languageExtensions = isJsonContent
      ? [json()]
      : contentType.includes("text/html")
        ? [html()]
        : contentType.includes("text/xml") ||
            contentType.includes("application/xml")
          ? [xml()]
          : [];

    return [...languageExtensions, search(), keymap.of(searchKeymap)];
  }, [contentType, isJsonContent]);

  if (!response || !body) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No response body
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      {isTruncated ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Response body is {formatBytes(bodyBytes)}. Showing first 1MB.
        </div>
      ) : null}

      {parsedJsonBody ? (
        <JsonFilter
          parsedBody={parsedJsonBody}
          rawDisplayBody={rawDisplayBody}
          onDisplayBodyChange={setDisplayBody}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <CodeMirror
          value={displayBody}
          editable={false}
          readOnly
          extensions={extensions}
          height="100%"
          minHeight="100px"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: false,
          }}
          theme={isDark ? oneDark : "light"}
        />
      </div>
    </div>
  );
}

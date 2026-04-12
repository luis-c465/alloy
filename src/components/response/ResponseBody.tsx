import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

import { useRequestStore } from "~/stores/request-store";

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

  const match = headers.find((header) => header.key.toLowerCase() === "content-type");
  return match?.value.toLowerCase() ?? "";
};

export function ResponseBody() {
  const response = useRequestStore((state) => state.response);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const contentType = getContentType(response?.headers);
  const body = response?.body ?? "";
  const bodyBytes = new Blob([body]).size;
  const isTruncated = bodyBytes > MAX_PREVIEW_BYTES;
  const previewBody = isTruncated ? body.slice(0, MAX_PREVIEW_BYTES) : body;

  let bodyValue = previewBody;
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(previewBody);
      bodyValue = JSON.stringify(parsed, null, 2);
    } catch {
      bodyValue = previewBody;
    }
  }

  const extensions = contentType.includes("application/json")
    ? [json()]
    : contentType.includes("text/html")
      ? [html()]
      : contentType.includes("text/xml") || contentType.includes("application/xml")
        ? [xml()]
        : [];

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

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <CodeMirror
          value={bodyValue}
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

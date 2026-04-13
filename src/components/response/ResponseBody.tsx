import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { search, searchKeymap } from "@codemirror/search";
import { xml } from "@codemirror/lang-xml";
import { keymap } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";

import { BinaryPreview } from "~/components/response/BinaryPreview";
import { JsonFilter } from "~/components/response/JsonFilter";
import { CodeEditor } from "~/components/ui/CodeEditor";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { formatBytes } from "~/lib/format";

const MAX_PREVIEW_BYTES = 1024 * 1024;

const getContentType = (
  contentType: string | undefined,
  headers: Array<{ key: string; value: string }> | undefined,
): string => {
  if (contentType?.trim()) {
    return contentType.toLowerCase();
  }

  if (!headers) {
    return "";
  }

  const match = headers.find(
    (header) => header.key.toLowerCase() === "content-type",
  );
  return match?.value.toLowerCase() ?? "";
};

const guessExtension = (contentType: string): string => {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  switch (normalized) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    case "application/zip":
      return ".zip";
    case "application/octet-stream":
      return ".bin";
    default:
      return "";
  }
};

const getSuggestedFilename = (urlValue: string, contentType: string): string => {
  try {
    const parsed = new URL(urlValue);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();

    if (segment) {
      return decodeURIComponent(segment);
    }
  } catch {
    // Ignore invalid URLs and fall back to a generic filename.
  }

  return `response${guessExtension(contentType) || ".bin"}`;
};

export function ResponseBody() {
  const response = useActiveTabField("response", null);
  const requestUrl = useActiveTabField("url", "");
  const [displayBody, setDisplayBody] = useState("");

  const contentType = useMemo(
    () => getContentType(response?.content_type, response?.headers),
    [response],
  );
  const body = response?.body ?? "";
  const bodyBytes = useMemo(() => new Blob([body]).size, [body]);
  const isTruncated = bodyBytes > MAX_PREVIEW_BYTES;
  const previewBody = isTruncated ? body.slice(0, MAX_PREVIEW_BYTES) : body;
  const isJsonContent = contentType.includes("application/json");
  const suggestedFilename = useMemo(
    () => getSuggestedFilename(requestUrl, response?.content_type ?? contentType),
    [contentType, requestUrl, response?.content_type],
  );

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

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No response body
      </div>
    );
  }

  if (response.is_binary) {
    return (
      <BinaryPreview
        bodyBase64={response.body_base64}
        contentType={response.content_type || contentType}
        sizeBytes={response.size_bytes}
        suggestedFilename={suggestedFilename}
      />
    );
  }

  if (!body) {
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

      <CodeEditor
        value={displayBody}
        editable={false}
        readOnly
        extensions={extensions}
        minHeight="100px"
        className="min-h-0 flex-1 overflow-hidden"
      />
    </div>
  );
}

import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useState } from "react";

import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { cn } from "~/lib/utils";
import { useRequestStore } from "~/stores/request-store";

const BODY_TYPE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "form-urlencoded", label: "Form URL-Encoded" },
  { value: "raw", label: "Raw" },
] as const;

const RAW_TYPE_OPTIONS = [
  { value: "text/plain", label: "Text" },
  { value: "application/xml", label: "XML" },
  { value: "text/html", label: "HTML" },
  { value: "application/javascript", label: "JavaScript" },
] as const;

export function BodyEditor() {
  const bodyType = useActiveTabField("bodyType", "none");
  const bodyContent = useActiveTabField("bodyContent", "");
  const bodyFormData = useActiveTabField("bodyFormData", []);
  const rawContentType = useActiveTabField("rawContentType", "text/plain");
  const setBodyType = useRequestStore((state) => state.setBodyType);
  const setBodyContent = useRequestStore((state) => state.setBodyContent);
  const setBodyFormData = useRequestStore((state) => state.setBodyFormData);
  const setRawContentType = useRequestStore((state) => state.setRawContentType);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const rawNormalized = useMemo(() => {
    return RAW_TYPE_OPTIONS.some((option) => option.value === rawContentType)
      ? rawContentType
      : "text/plain";
  }, [rawContentType]);

  const jsonExtensions = useMemo(() => [json()], []);
  const rawExtensions = useMemo(() => {
    if (rawNormalized.includes("xml")) {
      return [xml()];
    }

    if (rawNormalized.includes("html")) {
      return [html()];
    }

    return [];
  }, [rawNormalized]);

  const handleBodyChange = useCallback(
    (value: string) => {
      setBodyContent(value);
    },
    [setBodyContent],
  );

  return (
    <div className="flex h-full min-h-[100px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {BODY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setBodyType(option.value)}
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                bodyType === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {bodyType === "raw" ? (
          <Select value={rawNormalized} onValueChange={setRawContentType}>
            <SelectTrigger className="h-7 w-[170px] text-xs">
              <SelectValue placeholder="Content type" />
            </SelectTrigger>
            <SelectContent>
              {RAW_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {bodyType === "none" ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          This request does not have a body.
        </div>
      ) : null}

      {bodyType === "form-urlencoded" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <KeyValueEditor
            items={bodyFormData}
            onChange={setBodyFormData}
            keyPlaceholder="Field name"
            valuePlaceholder="Value"
          />
        </div>
      ) : null}

      {bodyType === "json" ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <CodeMirror
            value={bodyContent}
            onChange={handleBodyChange}
            extensions={jsonExtensions}
            height="100%"
            minHeight="100px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: true,
            }}
            theme={isDark ? oneDark : "light"}
          />
        </div>
      ) : null}

      {bodyType === "raw" ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <CodeMirror
            value={bodyContent}
            onChange={handleBodyChange}
            extensions={rawExtensions}
            height="100%"
            minHeight="100px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: true,
            }}
            theme={isDark ? oneDark : "light"}
          />
        </div>
      ) : null}
    </div>
  );
}

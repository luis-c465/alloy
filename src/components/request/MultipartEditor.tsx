import { useMemo, useState } from "react";
import { IconUpload, IconX } from "@tabler/icons-react";
import { useDefaultLayout } from "react-resizable-panels";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { VariableInput } from "~/components/ui/VariableInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { pickFile } from "~/lib/api";
import { cn } from "~/lib/utils";
import {
  useRequestStore,
  type MultipartField,
} from "~/stores/request-store";

type MultipartValueType = "text" | "file";

// Stable empty array fallback for useRequestStore selectors. Returning an
// inline `?? []` literal inside a Zustand selector creates a new array reference
// on every call, which causes React's useSyncExternalStore to detect a spurious
// change and trigger an infinite re-render loop.
const EMPTY_MULTIPART_FIELDS: MultipartField[] = [];

const createEmptyRow = (): MultipartField => ({
  key: "",
  value: { Text: "" },
  content_type: null,
  enabled: true,
  id: crypto.randomUUID(),
  fileSizeBytes: null,
});

const isTextValue = (row: MultipartField): row is MultipartField & { value: { Text: string } } =>
  "Text" in row.value;

const isFileValue = (
  row: MultipartField,
): row is MultipartField & { value: { File: { path: string; filename: string | null } } } =>
  "File" in row.value;

const isEmptyRow = (row: MultipartField): boolean => {
  if (!row.key.trim()) {
    if (isTextValue(row)) {
      return !row.value.Text.trim();
    }

    if (isFileValue(row)) {
      return !row.value.File.path.trim();
    }
  }

  return false;
};

const ensureTrailingEmptyRow = (items: MultipartField[]): MultipartField[] => {
  if (items.length === 0) {
    return [createEmptyRow()];
  }

  const lastRow = items[items.length - 1];
  if (!isEmptyRow(lastRow)) {
    return [...items, createEmptyRow()];
  }

  return items;
};

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

const detectContentType = (fileName: string): string | null => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension) {
    return null;
  }

  const types: Record<string, string> = {
    csv: "text/csv",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webp: "image/webp",
    xml: "application/xml",
    zip: "application/zip",
  };

  return types[extension] ?? null;
};

export function MultipartEditor() {
  const outerLayoutState = useDefaultLayout({
    id: "request-multipart-key-trailing-columns",
    panelIds: ["key", "trailing"],
    storage: window.localStorage,
  });
  const valueContentLayoutState = useDefaultLayout({
    id: "request-multipart-value-content-columns",
    panelIds: ["value", "contentType"],
    storage: window.localStorage,
  });
  const [outerLayout, setOuterLayout] = useState<Record<string, number>>(
    outerLayoutState.defaultLayout ?? { key: 26, trailing: 74 },
  );
  const [valueContentLayout, setValueContentLayout] = useState<Record<string, number>>(
    valueContentLayoutState.defaultLayout ?? { value: 70, contentType: 30 },
  );

  const items = useRequestStore((state) => state.tabs.find(
    (tab) => tab.id === (state.activeTabId ?? state.tabs[0]?.id),
  )?.multipartFields ?? EMPTY_MULTIPART_FIELDS);
  const setMultipartFields = useRequestStore((state) => state.setMultipartFields);
  const rows = items.length > 0 ? items : [createEmptyRow()];

  const rowGridTemplate = useMemo(() => {
    const key = outerLayout.key ?? 26;
    const trailing = outerLayout.trailing ?? 74;
    const valueInTrailing = valueContentLayout.value ?? 70;
    const contentInTrailing = valueContentLayout.contentType ?? 30;

    const value = (trailing * valueInTrailing) / 100;
    const contentType = (trailing * contentInTrailing) / 100;

    return `40px minmax(120px, ${key}fr) 110px minmax(180px, ${value}fr) minmax(140px, ${contentType}fr) 36px`;
  }, [outerLayout, valueContentLayout]);

  const updateRows = (nextRows: MultipartField[]) => {
    setMultipartFields(ensureTrailingEmptyRow(nextRows));
  };

  const updateRow = (rowId: string, patch: Partial<MultipartField>) => {
    updateRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const setRowType = (rowId: string, valueType: MultipartValueType) => {
    updateRows(
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        if (valueType === "text") {
          const nextText = isTextValue(row) ? row.value.Text : "";
          return {
            ...row,
            value: { Text: nextText },
            fileSizeBytes: null,
          };
        }

        return {
          ...row,
          value: { File: { path: "", filename: null } },
          fileSizeBytes: null,
        };
      }),
    );
  };

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) {
      setMultipartFields([createEmptyRow()]);
      return;
    }

    updateRows(rows.filter((row) => row.id !== rowId));
  };

  const handlePickFile = async (row: MultipartField) => {
    const selected = await pickFile();
    if (!selected) {
      return;
    }

    updateRow(row.id, {
      value: {
        File: {
          path: selected.path,
          filename: selected.name,
        },
      },
      fileSizeBytes: selected.size_bytes ?? null,
      content_type: row.content_type || detectContentType(selected.name),
    });
  };

  return (
    <TooltipProvider>
      <div className="h-full overflow-auto rounded-md border border-border">
        <div className="grid min-w-[900px] grid-cols-[40px_1fr_36px] border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="text-center">On</span>

          <ResizablePanelGroup
            orientation="horizontal"
            id="request-multipart-key-trailing-columns"
            defaultLayout={outerLayoutState.defaultLayout}
            onLayoutChange={setOuterLayout}
            onLayoutChanged={outerLayoutState.onLayoutChanged}
            className="min-w-0 items-center h-full"
          >
            <ResizablePanel id="key" minSize="16%" defaultSize="26%">
              <span className="block px-1">Key</span>
            </ResizablePanel>

            <ResizableHandle withHandle className="mx-1 bg-border/80" />

            <ResizablePanel id="trailing" minSize="30%" defaultSize="74%">
              <div className="grid h-full min-w-0 grid-cols-[110px_1fr] items-center">
                <span className="px-1">Type</span>

                <ResizablePanelGroup
                  orientation="horizontal"
                  id="request-multipart-value-content-columns"
                  defaultLayout={valueContentLayoutState.defaultLayout}
                  onLayoutChange={setValueContentLayout}
                  onLayoutChanged={valueContentLayoutState.onLayoutChanged}
                  className="min-w-0 items-center"
                >
                  <ResizablePanel id="value" minSize="25%" defaultSize="70%">
                    <span className="block px-1">Value</span>
                  </ResizablePanel>

                  <ResizableHandle withHandle className="mx-1 bg-border/80 w-[12px]!" />

                  <ResizablePanel id="contentType" minSize="15%" defaultSize="30%">
                    <span className="block px-1">Content Type</span>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>

          <span className="sr-only">Delete</span>
        </div>

        <div className="divide-y divide-border">
          {rows.map((row) => {
            const valueType: MultipartValueType = isFileValue(row) ? "file" : "text";
            const fileName = isFileValue(row) ? row.value.File.filename ?? "Selected file" : null;
            const fileMeta = fileName
              ? row.fileSizeBytes !== null
                ? `${fileName} · ${formatBytes(row.fileSizeBytes)}`
                : fileName
              : null;

            return (
              <div
                key={row.id}
                className="grid items-center gap-2 px-2 py-1.5"
                style={{ gridTemplateColumns: rowGridTemplate }}
              >
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      updateRow(row.id, { enabled: event.target.checked })
                    }
                    aria-label="Toggle multipart field"
                    className="size-3.5 rounded border-border"
                  />
                </div>

                <Input
                  value={row.key}
                  placeholder="Field name"
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                  className={cn(
                    "h-7 rounded-sm border-input/70 bg-transparent text-xs",
                    "font-mono",
                  )}
                />

                <Select
                  value={valueType}
                  onValueChange={(value) => setRowType(row.id, value as MultipartValueType)}
                >
                  <SelectTrigger className="h-7 w-full rounded-sm text-xs">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="file">File</SelectItem>
                  </SelectContent>
                </Select>

                {valueType === "text" ? (
                  <VariableInput
                    value={isTextValue(row) ? row.value.Text : ""}
                    placeholder="Value"
                    onChange={(value) =>
                      updateRow(row.id, { value: { Text: value } })
                    }
                    singleLine
                    className="h-7 rounded-sm"
                  />
                ) : (
                  <div className="flex min-w-0 items-center gap-2 rounded-sm border border-input/70 bg-transparent px-2 py-1">
                    <div className="min-w-0 flex-1 text-xs">
                      {fileMeta ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate font-mono text-foreground">
                              {fileMeta}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={4}>{fileMeta}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="block truncate text-muted-foreground">
                          No file selected
                        </span>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void handlePickFile(row)}
                    >
                      <IconUpload className="size-3" />
                      Browse
                    </Button>
                  </div>
                )}

                <Input
                  value={row.content_type ?? ""}
                  placeholder="Auto"
                  onChange={(event) =>
                    updateRow(row.id, {
                      content_type: event.target.value.trim() || null,
                    })
                  }
                  className={cn(
                    "h-7 rounded-sm border-input/70 bg-transparent text-xs",
                    "font-mono",
                  )}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => deleteRow(row.id)}
                  aria-label="Delete row"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <IconX className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

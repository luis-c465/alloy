import { useCallback, useMemo, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { useDefaultLayout } from "react-resizable-panels";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { VariableInput } from "~/components/ui/VariableInput";
import { cn } from "~/lib/utils";
import { createEmptyKeyValue, type KeyValue } from "~/stores/request-store";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

const isEmptyRow = (item: KeyValue): boolean =>
  !item.key.trim() && !item.value.trim();

const ensureTrailingEmptyRow = (items: KeyValue[]): KeyValue[] => {
  if (items.length === 0) {
    return [createEmptyKeyValue()];
  }

  const lastRow = items[items.length - 1];
  if (!isEmptyRow(lastRow)) {
    return [...items, createEmptyKeyValue()];
  }

  return items;
};

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KeyValueEditorProps) {
  const layoutState = useDefaultLayout({
    id: "request-key-value-columns",
    panelIds: ["key", "value"],
    storage: window.localStorage,
  });
  const [columnLayout, setColumnLayout] = useState<Record<string, number>>(
    layoutState.defaultLayout ?? { key: 50, value: 50 },
  );
  const rows = items.length > 0 ? items : [createEmptyKeyValue()];

  const rowGridTemplate = useMemo(() => {
    const key = columnLayout.key ?? 50;
    const value = columnLayout.value ?? 50;
    return `40px minmax(120px, ${key}fr) minmax(140px, ${value}fr) 36px`;
  }, [columnLayout]);

  const updateRow = useCallback((rowId: string, patch: Partial<KeyValue>) => {
    const nextRows = rows.map((row) =>
      row.id === rowId ? { ...row, ...patch } : row,
    );
    onChange(ensureTrailingEmptyRow(nextRows));
  }, [onChange, rows]);

  const deleteRow = useCallback((rowId: string) => {
    if (rows.length <= 1) {
      onChange([createEmptyKeyValue()]);
      return;
    }

    const nextRows = rows.filter((row) => row.id !== rowId);
    onChange(ensureTrailingEmptyRow(nextRows));
  }, [onChange, rows]);

  return (
    <div className="h-full overflow-auto rounded-md border border-border">
      <div
        className="grid min-w-[480px] border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: rowGridTemplate }}
      >
        <span className="text-center">On</span>

        <ResizablePanelGroup
          orientation="horizontal"
          id="request-key-value-columns"
          className="col-span-2 min-w-0 items-center h-[50px]"
          defaultLayout={layoutState.defaultLayout}
          onLayoutChange={setColumnLayout}
          onLayoutChanged={layoutState.onLayoutChanged}
        >
          <ResizablePanel id="key" minSize="20%" defaultSize="50%" className="h-full">
            <span className="block px-1">Key</span>
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1 bg-border/80 w-[12px]!" />
          <ResizablePanel id="value" minSize="20%" defaultSize="50%">
            <span className="block px-1">Value</span>
          </ResizablePanel>
        </ResizablePanelGroup>

        <span className="sr-only">Delete</span>
      </div>

      <div className="divide-y divide-border">
        {rows.map((item) => (
          <div
            key={item.id}
            className="grid items-center gap-2 px-2 py-1.5"
            style={{ gridTemplateColumns: rowGridTemplate }}
          >
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(event) =>
                  updateRow(item.id, { enabled: event.target.checked })
                }
                aria-label="Toggle entry"
                className="size-3.5 rounded border-border"
              />
            </div>

            <Input
              value={item.key}
              placeholder={keyPlaceholder}
              onChange={(event) =>
                updateRow(item.id, { key: event.target.value })
              }
              className={cn(
                "h-7 rounded-sm border-input/70 bg-transparent text-xs",
                "font-mono",
              )}
            />

            <VariableInput
              value={item.value}
              placeholder={valuePlaceholder}
              onChange={(value) => updateRow(item.id, { value })}
              singleLine
              className="h-7 rounded-sm"
            />

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => deleteRow(item.id)}
              aria-label="Delete row"
              className="text-muted-foreground hover:text-destructive"
            >
              <IconX className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

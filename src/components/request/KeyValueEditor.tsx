import { IconX } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { KeyValue } from "~/stores/request-store";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

const createEmptyRow = (): KeyValue => ({
  key: "",
  value: "",
  enabled: true,
  id: crypto.randomUUID(),
});

const isEmptyRow = (item: KeyValue): boolean => !item.key.trim() && !item.value.trim();

const ensureTrailingEmptyRow = (items: KeyValue[]): KeyValue[] => {
  if (items.length === 0) {
    return [createEmptyRow()];
  }

  const lastRow = items[items.length - 1];
  if (!isEmptyRow(lastRow)) {
    return [...items, createEmptyRow()];
  }

  return items;
};

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KeyValueEditorProps) {
  const rows = items.length > 0 ? items : [createEmptyRow()];

  const updateRow = (rowId: string, patch: Partial<KeyValue>) => {
    const nextRows = rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
    onChange(ensureTrailingEmptyRow(nextRows));
  };

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) {
      onChange([createEmptyRow()]);
      return;
    }

    const nextRows = rows.filter((row) => row.id !== rowId);
    onChange(ensureTrailingEmptyRow(nextRows));
  };

  return (
    <div className="h-full overflow-auto rounded-md border border-border">
      <div className="grid min-w-[480px] grid-cols-[40px_1fr_1fr_36px] border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-center">On</span>
        <span>Key</span>
        <span>Value</span>
        <span className="sr-only">Delete</span>
      </div>

      <div className="divide-y divide-border">
        {rows.map((item) => (
          <div key={item.id} className="grid grid-cols-[40px_1fr_1fr_36px] items-center gap-2 px-2 py-1.5">
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(event) => updateRow(item.id, { enabled: event.target.checked })}
                aria-label="Toggle entry"
                className="size-3.5 rounded border-border"
              />
            </div>

            <Input
              value={item.key}
              placeholder={keyPlaceholder}
              onChange={(event) => updateRow(item.id, { key: event.target.value })}
              className={cn(
                "h-7 rounded-sm border-input/70 bg-transparent text-xs",
                "font-mono",
              )}
            />

            <Input
              value={item.value}
              placeholder={valuePlaceholder}
              onChange={(event) => updateRow(item.id, { value: event.target.value })}
              className={cn(
                "h-7 rounded-sm border-input/70 bg-transparent text-xs",
                "font-mono",
              )}
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

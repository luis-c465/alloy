import { IconFileCode, IconFolder } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

type PendingCreationRowProps = {
  type: "file" | "folder";
  name: string;
  depth: number;
  isBusy: boolean;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function PendingCreationRow({
  type,
  name,
  depth,
  isBusy,
  onNameChange,
  onSubmit,
  onCancel,
}: PendingCreationRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, []);

  return (
    <div
      className={cn(
        "group/tree-row relative flex h-7 min-w-0 items-center rounded-sm text-xs",
        "bg-muted/40",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="mr-0.5 inline-flex size-4" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1">
        {type === "folder" ? (
          <IconFolder className="size-3.5 shrink-0 text-amber-500/70" />
        ) : (
          <IconFileCode className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Input
          ref={inputRef}
          value={name}
          autoFocus
          disabled={isBusy}
          className="h-6"
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
          onBlur={() => {
            onCancel();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
    </div>
  );
}

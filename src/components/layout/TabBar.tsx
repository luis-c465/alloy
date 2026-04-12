import { IconPlus, IconX } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";

export function TabBar() {
  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-background/95 pl-2">
      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          className="group flex h-full max-w-[150px] min-w-[120px] items-center gap-2 border-b-2 border-primary px-2 text-xs text-foreground"
        >
          <span className="inline-flex shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            GET
          </span>

          <span className="truncate text-left">New Request</span>

          <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded opacity-60 transition-opacity group-hover:opacity-100">
            <IconX className="size-3" />
          </span>
        </button>
      </div>

      <div className="pr-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New tab">
          <IconPlus />
        </Button>
      </div>
    </div>
  );
}

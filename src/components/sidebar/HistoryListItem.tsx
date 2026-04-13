import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type { HistoryListEntry } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

const methodClasses: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  POST: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PUT: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  PATCH: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-300",
  HEAD: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  OPTIONS: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

const getStatusClasses = (status: number): string => {
  if (status >= 200 && status < 300) {
    return "border-emerald-300 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300";
  }

  if (status >= 300 && status < 400) {
    return "border-amber-300 bg-amber-500/15 text-amber-700 dark:border-amber-500/40 dark:text-amber-300";
  }

  if (status >= 500) {
    return "border-rose-400 bg-rose-600/20 text-rose-800 dark:border-rose-500/50 dark:text-rose-300";
  }

  if (status >= 400) {
    return "border-red-300 bg-red-500/15 text-red-700 dark:border-red-500/40 dark:text-red-300";
  }

  return "";
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }

  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m ago`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h ago`;
  }

  if (diffMs < 2 * day) {
    return "Yesterday";
  }

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
};

type HistoryListItemProps = {
  entry: HistoryListEntry;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
};

export function HistoryListItem({ entry, onOpen, onDelete }: HistoryListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const formattedTimestamp = useMemo(() => formatTimestamp(entry.timestamp), [entry.timestamp]);

  const triggerStyle: CSSProperties = menuPosition
    ? {
        position: "fixed",
        left: menuPosition.x,
        top: menuPosition.y,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }
    : {
        position: "fixed",
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      };

  const method = entry.method.toUpperCase();

  return (
    <>
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
        onClick={() => {
          onOpen(entry.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPosition({ x: event.clientX, y: event.clientY });
          setMenuOpen(true);
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-5 min-w-10 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-semibold",
              methodClasses[method] ?? methodClasses.GET,
            )}
          >
            {method}
          </span>

          <span className="truncate text-xs font-medium">{entry.url}</span>
        </div>

        <div className="flex items-center gap-2 pl-12 text-[11px] text-muted-foreground">
          {entry.status !== null ? (
            <Badge variant="outline" className={cn("h-4 px-1.5 font-mono", getStatusClasses(entry.status))}>
              {entry.status}
            </Badge>
          ) : (
            <span>—</span>
          )}

          <span className="font-medium">{formattedTimestamp}</span>
        </div>
      </button>

      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) {
            setMenuPosition(null);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button type="button" aria-hidden tabIndex={-1} style={triggerStyle} />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem
            onSelect={() => {
              onOpen(entry.id);
            }}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              onDelete(entry.id);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

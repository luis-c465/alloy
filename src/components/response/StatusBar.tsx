import {
  IconAlertTriangle,
  IconClock,
  IconDatabase,
  IconLoader2,
} from "@tabler/icons-react";

import { Badge } from "~/components/ui/badge";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { cn } from "~/lib/utils";

const formatDuration = (timeMs: number): string => {
  if (timeMs >= 1000) {
    return `${(timeMs / 1000).toFixed(1)} s`;
  }

  return `${timeMs} ms`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const getBadgeClasses = (status: number): string => {
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

export function StatusBar() {
  const response = useActiveTabField("response", null);
  const isLoading = useActiveTabField("isLoading", false);
  const error = useActiveTabField("error", null);

  if (isLoading) {
    return (
      <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
        <IconLoader2 className="mr-2 size-4 animate-spin" />
        Sending request...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-9 items-center rounded-md border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-700 dark:text-red-300">
        <IconAlertTriangle className="mr-2 size-4" />
        <span className="truncate">{error}</span>
      </div>
    );
  }

  if (!response) {
    return null;
  }

  const displayStatus = response.status_text
    ? `${response.status} ${response.status_text}`
    : `${response.status}`;
  const responseSize =
    response.size_bytes > 0
      ? response.size_bytes
      : new Blob([response.body]).size;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <Badge
        variant="outline"
        className={cn("font-mono", getBadgeClasses(response.status))}
      >
        {displayStatus}
      </Badge>

      <div className="flex items-center gap-1.5 text-muted-foreground">
        <IconClock className="size-4" />
        <span className="font-mono">{formatDuration(response.time_ms)}</span>
      </div>

      <div className="flex items-center gap-1.5 text-muted-foreground">
        <IconDatabase className="size-4" />
        <span className="font-mono">{formatBytes(responseSize)}</span>
      </div>
    </div>
  );
}

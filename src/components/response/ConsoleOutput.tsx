import { useMemo } from "react";

import { useActiveTabField } from "~/hooks/useActiveTab";

type FlattenedScriptEntry = {
  phase: string;
  level: string;
  message: string;
};

const getLevelClass = (level: string): string => {
  const normalized = level.toLowerCase();

  if (normalized === "info") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }

  if (normalized === "warn") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  }

  if (normalized === "error") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }

  if (normalized === "debug") {
    return "border-border bg-muted/30 text-muted-foreground";
  }

  return "border-border bg-background text-foreground";
};

export function ConsoleOutput() {
  const preScriptResult = useActiveTabField("preScriptResult", null);
  const postScriptResult = useActiveTabField("postScriptResult", null);

  const consoleEntries = useMemo((): FlattenedScriptEntry[] => {
    const entries: FlattenedScriptEntry[] = [];

    if (preScriptResult?.console_output?.length) {
      entries.push(...preScriptResult.console_output.map((entry) => ({
        phase: entry.phase || "pre",
        level: entry.level,
        message: entry.message,
      })));
    }

    if (postScriptResult?.console_output?.length) {
      entries.push(...postScriptResult.console_output.map((entry) => ({
        phase: entry.phase || "post",
        level: entry.level,
        message: entry.message,
      })));
    }

    return entries;
  }, [preScriptResult?.console_output, postScriptResult?.console_output]);

  const scriptEnvSummaries = useMemo(() => {
    const summaries: Array<{ label: string; count: number; names: string[] }> = [];

    if (preScriptResult?.success) {
      const names = [
        ...preScriptResult.modified_environment_variables.map((item) => item.key),
        ...preScriptResult.unset_environment_variables,
      ];

      if (names.length > 0) {
        summaries.push({
          label: "Pre-request",
          count: names.length,
          names,
        });
      }
    }

    if (postScriptResult?.success) {
      const names = [
        ...postScriptResult.modified_environment_variables.map((item) => item.key),
        ...postScriptResult.unset_environment_variables,
      ];

      if (names.length > 0) {
        summaries.push({
          label: "Post-response",
          count: names.length,
          names,
        });
      }
    }

    return summaries;
  }, [postScriptResult, preScriptResult]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      {preScriptResult?.error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Pre-request script failed: {preScriptResult.error}
        </div>
      ) : null}

      {postScriptResult?.error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Post-response script failed: {postScriptResult.error}
        </div>
      ) : null}

      {scriptEnvSummaries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {scriptEnvSummaries.map((summary) => (
            <div
              key={`${summary.label}-${summary.names.join(",")}`}
              className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-300"
            >
              <p>
                {summary.label} script modified {summary.count} environment variables:
              </p>
              <p className="mt-1 font-mono text-xs">
                {summary.names.join(", ")}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {consoleEntries.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          No console output. Use <code className="font-mono">alloy.console.log(...)</code> in your scripts.
        </div>
      ) : (
        <div className="space-y-2">
          {consoleEntries.map((entry, index) => {
            const level = entry.level.trim().toLowerCase();

            return (
              <div
                key={`${entry.phase}-${index}-${entry.message}`}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono uppercase text-muted-foreground">[{entry.phase}]</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono ${getLevelClass(level)}`}>
                    {level}
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed text-foreground">
                  {entry.message}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

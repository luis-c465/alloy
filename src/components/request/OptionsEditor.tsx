import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;

const getTimeoutError = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return "Timeout must be a whole number in milliseconds.";
  }

  const timeout = Number(trimmed);

  if (timeout < MIN_TIMEOUT_MS) {
    return `Timeout must be at least ${MIN_TIMEOUT_MS} ms.`;
  }

  if (timeout > MAX_TIMEOUT_MS) {
    return `Timeout must be ${MAX_TIMEOUT_MS} ms or less.`;
  }

  return null;
};

export const OptionsEditor = memo(function OptionsEditor() {
  const activeTabId = useRequestStore((state) => state.activeTabId);
  const setSkipSslVerification = useRequestStore(
    (state) => state.setSkipSslVerification,
  );
  const setTimeoutMs = useRequestStore((state) => state.setTimeoutMs);
  const [timeoutInput, setTimeoutInput] = useState("");

  const skipSslVerification = useActiveTabField("skipSslVerification", false);
  const timeoutMs = useActiveTabField("timeoutMs", null);

  useEffect(() => {
    setTimeoutInput(activeTabId && timeoutMs !== null ? String(timeoutMs) : "");
  }, [activeTabId, timeoutMs]);

  const timeoutError = useMemo(() => getTimeoutError(timeoutInput), [timeoutInput]);

  const handleTimeoutChange = useCallback((nextValue: string) => {
    setTimeoutInput(nextValue);

    if (!nextValue.trim()) {
      setTimeoutMs(null);
      return;
    }

    if (getTimeoutError(nextValue) !== null) {
      return;
    }

    setTimeoutMs(Number(nextValue));
  }, [setTimeoutMs]);

  return (
    <div className="flex h-full min-h-[100px] flex-col gap-4 overflow-auto rounded-md border border-border p-4">
      <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Skip SSL certificate verification
            </p>
            <p className="text-xs text-muted-foreground">
              Allow requests to self-signed or otherwise invalid HTTPS certificates.
            </p>
          </div>

          <Switch
            checked={skipSslVerification}
            onCheckedChange={setSkipSslVerification}
            aria-label="Skip SSL certificate verification"
          />
        </div>

        {skipSslVerification ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Disabling SSL verification is insecure. Use only for development with self-signed certificates.
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
        <div className="space-y-1.5">
          <label htmlFor="request-timeout-ms" className="text-sm font-medium text-foreground">
            Timeout (ms)
          </label>
          <Input
            id="request-timeout-ms"
            type="number"
            min={MIN_TIMEOUT_MS}
            max={MAX_TIMEOUT_MS}
            step={1}
            value={timeoutInput}
            placeholder="Default (30000)"
            onChange={(event) => {
              handleTimeoutChange(event.target.value);
            }}
            aria-invalid={timeoutError ? true : undefined}
            className="max-w-xs font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to use the default 30000 ms timeout. Allowed range: {MIN_TIMEOUT_MS}-{MAX_TIMEOUT_MS} ms.
          </p>
          {timeoutError ? (
            <p className="text-xs text-destructive">{timeoutError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
});

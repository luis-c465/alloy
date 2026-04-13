import { IconFilterOff, IconFilterSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { resolveJsonPath } from "~/lib/json-path";

type FilterMode = "raw" | "filtered";

interface JsonFilterProps {
  parsedBody: unknown;
  rawDisplayBody: string;
  onDisplayBodyChange: (body: string) => void;
}

const formatFilteredValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

export function JsonFilter({
  parsedBody,
  rawDisplayBody,
  onDisplayBodyChange,
}: JsonFilterProps) {
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<FilterMode>("raw");
  const [noMatch, setNoMatch] = useState(false);
  const [debouncedPath, setDebouncedPath] = useState("");

  useEffect(() => {
    setPath("");
    setDebouncedPath("");
    setMode("raw");
    setNoMatch(false);
    onDisplayBodyChange(rawDisplayBody);
  }, [onDisplayBodyChange, rawDisplayBody]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedPath(path.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [path]);

  const resolvedValue = useMemo(() => {
    if (!debouncedPath) {
      return undefined;
    }

    return resolveJsonPath(parsedBody, debouncedPath);
  }, [debouncedPath, parsedBody]);

  useEffect(() => {
    if (mode === "raw" || !debouncedPath) {
      setNoMatch(false);
      onDisplayBodyChange(rawDisplayBody);
      return;
    }

    if (resolvedValue === undefined) {
      setNoMatch(true);
      onDisplayBodyChange(rawDisplayBody);
      return;
    }

    setNoMatch(false);
    onDisplayBodyChange(formatFilteredValue(resolvedValue));
  }, [debouncedPath, mode, onDisplayBodyChange, rawDisplayBody, resolvedValue]);

  const handlePathChange = (value: string) => {
    setPath(value);

    if (value.trim()) {
      setMode("filtered");
      return;
    }

    setMode("raw");
  };

  const handleClear = () => {
    setPath("");
    setDebouncedPath("");
    setMode("raw");
    setNoMatch(false);
    onDisplayBodyChange(rawDisplayBody);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          value={path}
          placeholder="Filter: e.g. data.users[0].name"
          onChange={(event) => handlePathChange(event.target.value)}
          className="h-8 flex-1 font-mono text-xs"
          aria-label="Filter JSON response"
        />

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "raw" ? "secondary" : "outline"}
            onClick={() => setMode("raw")}
          >
            Raw
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "filtered" ? "secondary" : "outline"}
            onClick={() => setMode("filtered")}
            disabled={!path.trim()}
          >
            <IconFilterSearch size={14} />
            Filtered
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleClear}
            disabled={!path}
            aria-label="Clear JSON filter"
          >
            <IconFilterOff size={14} />
          </Button>
        </div>
      </div>

      {noMatch ? (
        <p className="text-xs text-muted-foreground">No match for path.</p>
      ) : null}
    </div>
  );
}

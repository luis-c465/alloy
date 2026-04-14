import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconSearch, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { HistoryEntry, HistoryFilter, HttpResponseData } from "~/bindings";
import { HistoryListItem } from "~/components/sidebar/HistoryListItem";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { clearHistory, deleteHistoryEntry, getHistoryEntry, listHistory } from "~/lib/api";
import type { BodyType, KeyValue, Tab } from "~/stores/request-store";
import { useRequestStore } from "~/stores/request-store";

const HISTORY_PAGE_SIZE = 50;
const METHOD_FILTERS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const toKeyValueList = (raw: string | null): KeyValue[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is { key: string; value: string; enabled?: boolean } =>
          typeof item === "object" &&
          item !== null &&
          "key" in item &&
          "value" in item &&
          typeof item.key === "string" &&
          typeof item.value === "string",
      )
      .map((item) => ({
        key: item.key,
        value: item.value,
        enabled: item.enabled ?? true,
        id: crypto.randomUUID(),
      }));
  } catch {
    return [];
  }
};

const parseQueryParams = (url: string): KeyValue[] => {
  if (!url.trim()) {
    return [];
  }

  try {
    const parsedUrl = new URL(url);
    const params: KeyValue[] = [];

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      params.push({
        key,
        value,
        enabled: true,
        id: crypto.randomUUID(),
      });
    }

    return params;
  } catch {
    return [];
  }
};

const parseFormBody = (body: string): KeyValue[] => {
  const params = new URLSearchParams(body);
  const entries: KeyValue[] = [];

  for (const [key, value] of params.entries()) {
    entries.push({
      key,
      value,
      enabled: true,
      id: crypto.randomUUID(),
    });
  }

  return entries;
};

const inferBodyType = (headers: KeyValue[], body: string | null): BodyType => {
  if (!body?.trim()) {
    return "none";
  }

  const contentType =
    headers.find((header) => header.key.toLowerCase() === "content-type")?.value.toLowerCase() ??
    "";

  if (contentType.includes("json")) {
    return "json";
  }

  if (contentType.includes("x-www-form-urlencoded")) {
    return "form-urlencoded";
  }

  const trimmedBody = body.trim();
  if (trimmedBody.startsWith("{") || trimmedBody.startsWith("[")) {
    try {
      JSON.parse(trimmedBody);
      return "json";
    } catch {
      return "raw";
    }
  }

  return "raw";
};

const toResponse = (entry: HistoryEntry): HttpResponseData | null => {
  if (entry.status === null) {
    return null;
  }

  return {
    status: entry.status,
    status_text: entry.status_text ?? "",
    headers: toKeyValueList(entry.response_headers).map(({ key, value, enabled }) => ({
      key,
      value,
      enabled,
    })),
    body: entry.response_body ?? "",
    is_binary: false,
    body_base64: null,
    content_type:
      toKeyValueList(entry.response_headers).find(
        (header) => header.key.toLowerCase() === "content-type",
      )?.value ?? "",
    size_bytes: entry.size_bytes ?? 0,
    time_ms: entry.time_ms ?? 0,
    is_truncated: false,
  };
};

const getTabName = (entry: HistoryEntry): string => {
  try {
    const parsed = new URL(entry.url);
    return `${entry.method.toUpperCase()} ${parsed.pathname || "/"}`;
  } catch {
    return `${entry.method.toUpperCase()} Request`;
  }
};

const mapHistoryEntryToTab = (entry: HistoryEntry): Partial<Tab> => {
  const headers = toKeyValueList(entry.request_headers);
  const bodyType = inferBodyType(headers, entry.request_body);

  return {
    name: getTabName(entry),
    filePath: null,
    isDirty: false,
    method: entry.method || "GET",
    url: entry.url,
    headers,
    queryParams: parseQueryParams(entry.url),
    bodyType,
    bodyContent: entry.request_body ?? "",
    bodyFormData:
      bodyType === "form-urlencoded"
        ? parseFormBody(entry.request_body ?? "")
        : [{ key: "", value: "", enabled: true, id: crypto.randomUUID() }],
    rawContentType:
      headers.find((header) => header.key.toLowerCase() === "content-type")?.value ||
      (bodyType === "json" ? "application/json" : "text/plain"),
    response: toResponse(entry),
    isLoading: false,
    error: null,
    activeRequestTab: "params",
    activeResponseTab: "body",
  };
};

export function HistoryPanel() {
  const queryClient = useQueryClient();
  const createTab = useRequestStore((state) => state.createTab);
  const hasInFlightRequest = useRequestStore((state) => state.tabs.some((tab) => tab.isLoading));

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<string | null>(null);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const previousInFlightRef = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setLimit(HISTORY_PAGE_SIZE);
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  useEffect(() => {
    if (previousInFlightRef.current && !hasInFlightRequest) {
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    }

    previousInFlightRef.current = hasInFlightRequest;
  }, [hasInFlightRequest, queryClient]);

  const filter = useMemo<HistoryFilter>(
    () => ({
      query: debouncedSearch.length > 0 ? debouncedSearch : null,
      method: methodFilter,
      status_min: null,
      status_max: null,
      limit,
    }),
    [debouncedSearch, methodFilter, limit],
  );

  const historyQuery = useQuery({
    queryKey: ["history", filter],
    queryFn: () => listHistory(filter),
    placeholderData: (previousData) => previousData,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteHistoryEntry,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const entries = historyQuery.data ?? [];
  const hasMore = entries.length >= limit;

  const handleOpen = async (id: number) => {
    const entry = await getHistoryEntry(id);
    if (!entry) {
      return;
    }

    void createTab(mapHistoryEntryToTab(entry));
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm("Clear all request history?");
    if (!confirmed) {
      return;
    }

    await clearMutation.mutateAsync();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            placeholder="Search history by URL"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {METHOD_FILTERS.map((method) => {
            const isActive = methodFilter === method;
            return (
              <Button
                key={method}
                type="button"
                size="xs"
                variant={isActive ? "default" : "outline"}
                onClick={() => {
                  setMethodFilter((current) => {
                    setLimit(HISTORY_PAGE_SIZE);
                    return current === method ? null : method;
                  });
                }}
              >
                {method}
              </Button>
            );
          })}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onScroll={(event) => {
          if (historyQuery.isFetching || !hasMore) {
            return;
          }

          const target = event.currentTarget;
          const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 40;
          if (nearBottom) {
            setLimit((current) => current + HISTORY_PAGE_SIZE);
          }
        }}
      >
        {historyQuery.isLoading ? (
          <div className="p-2 text-xs text-muted-foreground">Loading history...</div>
        ) : null}

        {historyQuery.error ? (
          <div className="p-2 text-xs text-destructive">
            {historyQuery.error instanceof Error
              ? historyQuery.error.message
              : "Failed to load history"}
          </div>
        ) : null}

        {!historyQuery.isLoading && !historyQuery.error && entries.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">No history yet.</div>
        ) : null}

        <div className="space-y-1">
          {entries.map((entry) => (
            <HistoryListItem
              key={entry.id}
              entry={entry}
              onOpen={(id) => {
                void handleOpen(id);
              }}
              onDelete={(id) => {
                void handleDelete(id);
              }}
            />
          ))}
        </div>

        {historyQuery.isFetching && !historyQuery.isLoading ? (
          <div className="p-2 text-xs text-muted-foreground">Loading more…</div>
        ) : null}
      </div>

      <div className="border-t border-border p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-center"
          onClick={() => {
            void handleClearAll();
          }}
          disabled={clearMutation.isPending || entries.length === 0}
        >
          <IconTrash className="size-3.5" />
          Clear All
        </Button>
      </div>
    </div>
  );
}

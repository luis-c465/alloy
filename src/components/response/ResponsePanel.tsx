import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { EmptyState } from "~/components/response/EmptyState";
import { ResponseBody } from "~/components/response/ResponseBody";
import { ResponseHeaders } from "~/components/response/ResponseHeaders";
import { StatusBar } from "~/components/response/StatusBar";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useRequestStore } from "~/stores/request-store";

export function ResponsePanel() {
  const response = useRequestStore((state) => state.response);
  const isLoading = useRequestStore((state) => state.isLoading);
  const error = useRequestStore((state) => state.error);
  const activeResponseTab = useRequestStore((state) => state.activeResponseTab);
  const setActiveResponseTab = useRequestStore((state) => state.setActiveResponseTab);
  const [copied, setCopied] = useState(false);

  const showEmptyState = !response && !isLoading && !error;
  const headersCount = response?.headers.length ?? 0;
  const canCopyBody = Boolean(response?.body);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyResponseBody = async () => {
    if (!response?.body) {
      return;
    }

    try {
      await navigator.clipboard.writeText(response.body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-3">
      {showEmptyState ? (
        <EmptyState />
      ) : (
        <>
          <StatusBar />

          <Tabs
            value={activeResponseTab}
            onValueChange={(tab) => setActiveResponseTab(tab as "body" | "headers")}
            className="mt-3 flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center justify-between gap-2">
              <TabsList className="w-fit">
                <TabsTrigger value="body">Body</TabsTrigger>
                <TabsTrigger value="headers">Headers ({headersCount})</TabsTrigger>
              </TabsList>

              {activeResponseTab === "body" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => void copyResponseBody()}
                  disabled={!canCopyBody}
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {copied ? "Copied" : "Copy response body"}
                </Button>
              ) : null}
            </div>

            <TabsContent value="body" className="mt-3 min-h-0 flex-1 overflow-hidden">
              <ResponseBody />
            </TabsContent>

            <TabsContent value="headers" className="mt-3 min-h-0 flex-1 overflow-hidden">
              <ResponseHeaders />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

import { EmptyState } from "~/components/response/EmptyState";
import { ResponseBody } from "~/components/response/ResponseBody";
import { ResponseHeaders } from "~/components/response/ResponseHeaders";
import { StatusBar } from "~/components/response/StatusBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useRequestStore } from "~/stores/request-store";

export function ResponsePanel() {
  const response = useRequestStore((state) => state.response);
  const isLoading = useRequestStore((state) => state.isLoading);
  const error = useRequestStore((state) => state.error);
  const activeResponseTab = useRequestStore((state) => state.activeResponseTab);
  const setActiveResponseTab = useRequestStore((state) => state.setActiveResponseTab);

  const showEmptyState = !response && !isLoading && !error;
  const headersCount = response?.headers.length ?? 0;

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
            <TabsList className="w-fit">
              <TabsTrigger value="body">Body</TabsTrigger>
              <TabsTrigger value="headers">Headers ({headersCount})</TabsTrigger>
            </TabsList>

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

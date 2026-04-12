import { BodyEditor } from "~/components/request/BodyEditor";
import { HeadersEditor } from "~/components/request/HeadersEditor";
import { MethodSelector } from "~/components/request/MethodSelector";
import { ParamsEditor } from "~/components/request/ParamsEditor";
import { SendButton } from "~/components/request/SendButton";
import { UrlBar } from "~/components/request/UrlBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

export function RequestPanel() {
  const activeRequestTab = useActiveTabField("activeRequestTab", "params");
  const setActiveRequestTab = useRequestStore(
    (state) => state.setActiveRequestTab,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <MethodSelector />
        <UrlBar />
        <SendButton />
      </div>

      <div className="min-h-0 flex-1 border-t border-border p-3">
        <Tabs
          value={activeRequestTab}
          onValueChange={(tab) =>
            setActiveRequestTab(tab as "params" | "headers" | "body")
          }
          className="flex h-full min-h-0 flex-col gap-3"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="body">Body</TabsTrigger>
          </TabsList>

          <TabsContent value="params" className="min-h-0 flex-1 overflow-auto">
            <ParamsEditor />
          </TabsContent>

          <TabsContent value="headers" className="min-h-0 flex-1 overflow-auto">
            <HeadersEditor />
          </TabsContent>

          <TabsContent value="body" className="min-h-0 flex-1 overflow-auto">
            <BodyEditor />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

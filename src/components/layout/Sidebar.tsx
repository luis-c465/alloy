import { IconClock, IconFolder } from "@tabler/icons-react";

import { CollectionsPanel } from "~/components/sidebar/CollectionsPanel";
import { HistoryPanel } from "~/components/sidebar/HistoryPanel";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useWorkspaceStore } from "~/stores/workspace-store";

export function Sidebar() {
  const activeTab = useWorkspaceStore((state) => state.sidebarTab);
  const setActiveTab = useWorkspaceStore((state) => state.setSidebarTab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (value === "collections" || value === "history") {
              setActiveTab(value);
            }
          }}
        >
          <TabsList className="w-full justify-start" variant="line">
            <TabsTrigger value="collections" className="max-w-8 flex-none px-2">
              <IconFolder className="size-3.5" />
              <span className="sr-only">Collections</span>
            </TabsTrigger>

            <TabsTrigger value="history" className="max-w-8 flex-none px-2">
              <IconClock className="size-3.5" />
              <span className="sr-only">History</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="collections" className="hidden" />
          <TabsContent value="history" className="hidden" />
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "collections" ? (
          <CollectionsPanel />
        ) : (
          <HistoryPanel />
        )}
      </ScrollArea>
    </div>
  );
}

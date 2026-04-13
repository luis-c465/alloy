import { IconClock, IconFolder } from "@tabler/icons-react";

import { CollectionsPanel } from "~/components/sidebar/CollectionsPanel";
import { HistoryPanel } from "~/components/sidebar/HistoryPanel";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { SIDEBAR_TABS, isSidebarTab } from "~/lib/constants";
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
            if (isSidebarTab(value)) {
              setActiveTab(value);
            }
          }}
        >
          <TabsList className="w-full justify-start" variant="line">
            {SIDEBAR_TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="max-w-8 flex-none px-2"
              >
                {tab === "collections" ? (
                  <IconFolder className="size-3.5" />
                ) : (
                  <IconClock className="size-3.5" />
                )}
                <span className="sr-only">
                  {tab === "collections" ? "Collections" : "History"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {SIDEBAR_TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="hidden" />
          ))}
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

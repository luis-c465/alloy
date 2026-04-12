import { IconClock, IconFolder } from "@tabler/icons-react";
import { useState } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

export function Sidebar() {
  const [activeTab, setActiveTab] = useState("collections");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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
          <div className="p-3 text-xs text-muted-foreground">
            Collections panel placeholder
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">
            History panel placeholder
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

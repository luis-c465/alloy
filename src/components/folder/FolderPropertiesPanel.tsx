import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { AuthEditor } from "~/components/request/AuthEditor";
import { useActiveTab } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

export function FolderPropertiesPanel() {
  const activeTab = useActiveTab();
  const setActiveFolderTab = useRequestStore((state) => state.setActiveFolderTab);
  const setFolderHeaders = useRequestStore((state) => state.setFolderHeaders);
  const setFolderVariables = useRequestStore((state) => state.setFolderVariables);

  if (!activeTab || activeTab.tabType !== "folder") {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        Folder Properties
      </div>

      <div className="min-h-0 flex-1 p-3">
        <Tabs
          value={activeTab.activeFolderTab}
          onValueChange={(value) => {
            if (value === "headers" || value === "variables" || value === "auth") {
              setActiveFolderTab(value);
            }
          }}
          className="flex h-full min-h-0 flex-col gap-3"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="variables">Variables</TabsTrigger>
            <TabsTrigger value="auth">Authorization</TabsTrigger>
          </TabsList>

          <TabsContent value="headers" className="min-h-0 flex-1 overflow-auto">
            <KeyValueEditor
              items={activeTab.folderHeaders}
              onChange={setFolderHeaders}
              keyPlaceholder="Header name"
              valuePlaceholder="Value"
            />
          </TabsContent>

          <TabsContent value="variables" className="min-h-0 flex-1 overflow-auto">
            <KeyValueEditor
              items={activeTab.folderVariables}
              onChange={setFolderVariables}
              keyPlaceholder="Variable name"
              valuePlaceholder="Value"
            />
          </TabsContent>

          <TabsContent value="auth" className="min-h-0 flex-1 overflow-auto">
            <AuthEditor authScope="folder" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

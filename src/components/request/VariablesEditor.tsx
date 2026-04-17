import { useMemo } from "react";
import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { useActiveTab } from "~/hooks/useActiveTab";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useWorkspaceStore } from "~/stores/workspace-store";
import { useRequestStore } from "~/stores/request-store";

export function VariablesEditor() {
  const activeTab = useActiveTab();
  const variables = useActiveTabField("variables", []);
  const setVariables = useRequestStore((state) => state.setVariables);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const getFolderConfigChain = useWorkspaceStore((state) => state.getFolderConfigChain);

  const inheritedItems = useMemo(() => {
    if (!activeTab || activeTab.tabType !== "request") {
      return [];
    }

    const chain = getFolderConfigChain(activeTab.filePath);
    return chain
      .map(({ folderPath, config }) => {
        const source = workspacePath && folderPath.startsWith(`${workspacePath}/`)
          ? folderPath.slice(workspacePath.length + 1) || "."
          : folderPath;
        const items = config.variables
          .filter((item) => item.enabled && item.key.trim().length > 0)
          .map((item, index) => ({
            ...item,
            id: `${folderPath}:variable:${index}:${item.key}`,
          }));
        return { source, items };
      })
      .filter((group) => group.items.length > 0);
  }, [activeTab, getFolderConfigChain, workspacePath]);

  return (
    <KeyValueEditor
      items={variables}
      onChange={setVariables}
      keyPlaceholder="Variable name"
      valuePlaceholder="Value"
      inheritedItems={inheritedItems}
    />
  );
}

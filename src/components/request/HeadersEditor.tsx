import { memo, useMemo } from "react";
import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import type { KeyValue } from "~/stores/request-store";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useWorkspaceStore } from "~/stores/workspace-store";
import { useRequestStore } from "~/stores/request-store";

const EMPTY_HEADERS: KeyValue[] = [];

export const HeadersEditor = memo(function HeadersEditor() {
  const tabType = useActiveTabField("tabType", "request");
  const filePath = useActiveTabField("filePath", null);
  const headers = useActiveTabField("headers", EMPTY_HEADERS);
  const setHeaders = useRequestStore((state) => state.setHeaders);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const getFolderConfigChain = useWorkspaceStore((state) => state.getFolderConfigChain);

  const inheritedItems = useMemo(() => {
    if (tabType !== "request" || !filePath) {
      return [];
    }

    const chain = getFolderConfigChain(filePath);
    return chain
      .map(({ folderPath, config }) => {
        const source = workspacePath && folderPath.startsWith(`${workspacePath}/`)
          ? folderPath.slice(workspacePath.length + 1) || "."
          : folderPath;
        const items = config.headers
          .filter((item) => item.enabled && item.key.trim().length > 0)
          .map((item, index) => ({
            ...item,
            id: `${folderPath}:header:${index}:${item.key}`,
          }));
        return { source, items };
      })
      .filter((group) => group.items.length > 0);
  }, [filePath, getFolderConfigChain, tabType, workspacePath]);

  return (
    <KeyValueEditor
      items={headers}
      onChange={setHeaders}
      keyPlaceholder="Header name"
      valuePlaceholder="Value"
      inheritedItems={inheritedItems}
    />
  );
});

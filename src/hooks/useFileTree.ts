import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listFiles } from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

export function useFileTree(workspacePath: string | null) {
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);

  const query = useQuery({
    queryKey: ["file-tree", workspacePath],
    enabled: Boolean(workspacePath),
    queryFn: async () => {
      if (!workspacePath) {
        return [];
      }

      return listFiles(workspacePath);
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!workspacePath) {
      setFileTree([]);
      return;
    }

    if (!query.data) {
      return;
    }

    setFileTree(query.data);
  }, [query.data, setFileTree, workspacePath]);

  return query;
}

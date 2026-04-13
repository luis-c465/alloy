import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listEnvironments } from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

export function useEnvironments(workspacePath: string | null) {
  const setEnvironments = useWorkspaceStore((state) => state.setEnvironments);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);

  const query = useQuery({
    queryKey: ["environments", workspacePath],
    enabled: Boolean(workspacePath),
    queryFn: async () => {
      if (!workspacePath) {
        return { environments: [], active: null };
      }

      return listEnvironments(workspacePath);
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!workspacePath) {
      setEnvironments([]);
      setActiveEnvironment(null);
      return;
    }

    if (!query.data) {
      return;
    }

    setEnvironments(query.data.environments);
    setActiveEnvironment(query.data.active);
  }, [query.data, setActiveEnvironment, setEnvironments, workspacePath]);

  return query;
}

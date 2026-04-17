import { useEffect, useMemo, useState } from "react";

import { resolveUrlPreview } from "~/lib/api";
import { useActiveTab } from "~/hooks/useActiveTab";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useWorkspaceStore } from "~/stores/workspace-store";

const HAS_TEMPLATE_VARIABLE = /\{\{\s*[^}]+\s*\}\}/;

export function ResolvedUrlPreview() {
  const activeTab = useActiveTab();
  const url = useActiveTabField("url", "");
  const filePath = useActiveTabField("filePath", null);
  const requestVariables = useActiveTabField("variables", []);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const folderConfigs = useWorkspaceStore((state) => state.folderConfigs);
  const getFolderConfigChain = useWorkspaceStore((state) => state.getFolderConfigChain);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const folderVariables = useMemo(() => {
    if (!filePath) {
      return [];
    }

    if (Object.keys(folderConfigs).length === 0) {
      return [];
    }

    return getFolderConfigChain(filePath).flatMap((entry) => entry.config.variables);
  }, [filePath, folderConfigs, getFolderConfigChain]);

  useEffect(() => {
    if (activeTab?.tabType !== "request") {
      setResolvedUrl(null);
      return;
    }

    if (!workspacePath || !activeEnvironment) {
      setResolvedUrl(null);
      return;
    }

    if (!url.trim() || !HAS_TEMPLATE_VARIABLE.test(url)) {
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;
    const mergedVariables = [...folderVariables, ...requestVariables];

    const timeout = setTimeout(() => {
      void resolveUrlPreview(url, workspacePath, activeEnvironment, mergedVariables)
        .then((result) => {
          if (!cancelled) {
            setResolvedUrl(result.trim() ? result : null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResolvedUrl(null);
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeEnvironment, activeTab?.tabType, folderVariables, requestVariables, url, workspacePath]);

  if (!resolvedUrl) {
    return null;
  }

  return (
    <div className="px-3 pb-2 text-xs text-muted-foreground">
      <span className="mr-1 font-medium">Resolved:</span>
      <span className="font-mono">{resolvedUrl}</span>
    </div>
  );
}

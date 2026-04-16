import { useEffect, useState } from "react";

import { resolveUrlPreview } from "~/lib/api";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useWorkspaceStore } from "~/stores/workspace-store";

const HAS_TEMPLATE_VARIABLE = /\{\{\s*[^}]+\s*\}\}/;

export function ResolvedUrlPreview() {
  const url = useActiveTabField("url", "");
  const requestVariables = useActiveTabField("variables", []);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!workspacePath || !activeEnvironment) {
      setResolvedUrl(null);
      return;
    }

    if (!url.trim() || !HAS_TEMPLATE_VARIABLE.test(url)) {
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;

    const timeout = setTimeout(() => {
      void resolveUrlPreview(url, workspacePath, activeEnvironment, requestVariables)
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
  }, [activeEnvironment, requestVariables, url, workspacePath]);

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

import { IconFile, IconFolder } from "@tabler/icons-react";
import { useMemo } from "react";

import { useActiveTab } from "~/hooks/useActiveTab";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { joinPath } from "~/lib/path";
import { cn } from "~/lib/utils";
import { useWorkspaceStore } from "~/stores/workspace-store";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";

type Segment = {
  label: string;
  path: string;
  isFile: boolean;
};

const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

const deriveSegments = (
  filePath: string,
  workspacePath: string | null,
): Segment[] => {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedWorkspacePath = workspacePath ? normalizePath(workspacePath) : null;
  const relativePath =
    normalizedWorkspacePath && normalizedFilePath.startsWith(`${normalizedWorkspacePath}/`)
      ? normalizedFilePath.slice(normalizedWorkspacePath.length + 1)
      : normalizedFilePath;

  const labels = relativePath.split("/").filter(Boolean);
  if (labels.length === 0) {
    return [];
  }

  const segments: Segment[] = [];
  let currentPath = workspacePath;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (!label) {
      continue;
    }

    const isFile = index === labels.length - 1;
    if (currentPath) {
      currentPath = joinPath(currentPath, label);
    }

    const absolutePath = currentPath ?? labels.slice(0, index + 1).join("/");

    segments.push({
      label,
      path: absolutePath,
      isFile,
    });
  }

  return segments;
};

export function RequestBreadcrumb() {
  const activeTab = useActiveTab();
  const filePath = useActiveTabField("filePath", null);
  const folderPath = useActiveTabField("folderPath", null);
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const revealPath = useWorkspaceStore((state) => state.revealPath);

  const segments = useMemo(() => {
    const targetPath = activeTab?.tabType === "folder" ? folderPath : filePath;
    if (!targetPath) {
      return [];
    }

    const derived = deriveSegments(targetPath, workspacePath);
    if (activeTab?.tabType === "folder" && derived.length > 0) {
      return derived.map((segment, index) => ({
        ...segment,
        isFile: index === derived.length - 1 ? false : segment.isFile,
      }));
    }

    return derived;
  }, [activeTab?.tabType, filePath, folderPath, workspacePath]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="px-3 pb-1">
      <Breadcrumb>
        <BreadcrumbList className="text-[11px]">
          {segments.map((segment, index) => (
            <BreadcrumbItem key={segment.path}>
              <BreadcrumbLink asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-muted",
                    segment.isFile && "text-foreground",
                  )}
                  onClick={() => {
                    revealPath(segment.path);
                  }}
                >
                  {segment.isFile ? (
                    <IconFile className="size-3 shrink-0" />
                  ) : (
                    <IconFolder className="size-3 shrink-0 text-amber-500" />
                  )}
                  <span className="truncate">{segment.label}</span>
                </button>
              </BreadcrumbLink>
              {index < segments.length - 1 ? <BreadcrumbSeparator /> : null}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

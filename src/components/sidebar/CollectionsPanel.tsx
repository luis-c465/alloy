import {
  IconFilePlus,
  IconFolderPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type { FileEntry } from "~/bindings";
import { OpenWorkspaceDialog } from "~/components/workspace/OpenWorkspaceDialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  createDirectory,
  createHttpFile,
  deletePath,
  readHttpFile,
  renamePath,
} from "~/lib/api";
import { cn } from "~/lib/utils";
import { useRequestStore } from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

import { FileTreeNode } from "./FileTreeNode";

type CreateMode =
  | { type: "file"; parentPath: string }
  | { type: "folder"; parentPath: string }
  | null;

const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;

const isHttpLikeFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".http") || lower.endsWith(".rest");
};

const getPathSeparator = (path: string): string => {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
};

const joinPath = (basePath: string, segment: string): string => {
  const separator = getPathSeparator(basePath);
  if (basePath.endsWith("/") || basePath.endsWith("\\")) {
    return `${basePath}${segment}`;
  }
  return `${basePath}${separator}${segment}`;
};

const getParentPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSlash <= 0) {
    return normalized;
  }
  return normalized.slice(0, lastSlash);
};

const findEntryByPath = (entries: FileEntry[], targetPath: string): FileEntry | null => {
  for (const entry of entries) {
    if (entry.path === targetPath) {
      return entry;
    }

    const children = entry.children ?? [];
    if (children.length === 0) {
      continue;
    }

    const match = findEntryByPath(children, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
};

const listSiblingNames = (
  entries: FileEntry[],
  parentPath: string,
): Set<string> => {
  const parent = findEntryByPath(entries, parentPath);
  if (!parent || !parent.is_dir) {
    return new Set();
  }

  const siblings = parent.children ?? [];
  return new Set(siblings.map((entry) => entry.name.toLowerCase()));
};

const isValidName = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return false;
  }

  return !INVALID_NAME_PATTERN.test(trimmed);
};

export function CollectionsPanel() {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const refreshFileTree = useWorkspaceStore((state) => state.refreshFileTree);

  const openRequestInTab = useRequestStore((state) => state.openRequestInTab);
  const activeFilePath = useRequestStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.filePath ?? null,
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createName, setCreateName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const selectedEntry = useMemo(() => {
    if (!selectedPath) {
      return null;
    }
    return findEntryByPath(fileTree, selectedPath);
  }, [fileTree, selectedPath]);

  const createParentPath = useMemo(() => {
    if (!workspacePath) {
      return null;
    }

    if (!selectedEntry) {
      return workspacePath;
    }

    return selectedEntry.is_dir ? selectedEntry.path : getParentPath(selectedEntry.path);
  }, [selectedEntry, workspacePath]);

  const startCreate = (mode: Exclude<CreateMode, null>) => {
    setError(null);
    setRenamingPath(null);
    setRenameDraft("");
    setCreateMode(mode);
    setCreateName(mode.type === "file" ? "new-request.http" : "new-folder");
  };

  const startCreateAtPath = (type: "file" | "folder", parentPath: string) => {
    startCreate({ type, parentPath });
  };

  const cancelCreate = () => {
    setCreateMode(null);
    setCreateName("");
  };

  const handleRefresh = async () => {
    if (!workspacePath || isBusy) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await refreshFileTree();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to refresh file tree",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenFile = async (path: string) => {
    if (isBusy) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const parsed = await readHttpFile(path);
      const requests = parsed.requests;
      if (requests.length === 0) {
        setError("This .http file has no requests to open.");
        return;
      }

      requests.forEach((request, index) => {
        openRequestInTab(request, path, index);
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open file");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!workspacePath || !createMode || isBusy) {
      return;
    }

    const rawName = createName.trim();
    if (!isValidName(rawName)) {
      setError("Invalid name. Avoid special characters and empty names.");
      return;
    }

    if (createMode.type === "file" && !rawName.toLowerCase().endsWith(".http")) {
      setError("New files must use the .http extension.");
      return;
    }

    const siblingNames = listSiblingNames(fileTree, createMode.parentPath);
    if (siblingNames.has(rawName.toLowerCase())) {
      setError("A file or folder with that name already exists.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      if (createMode.type === "file") {
        await createHttpFile(createMode.parentPath, rawName);
      } else {
        await createDirectory(createMode.parentPath, rawName);
      }

      cancelCreate();
      await refreshFileTree();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : `Failed to create ${createMode.type}`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    if (isBusy) {
      return;
    }

    const confirmed = window.confirm(`Delete "${entry.name}"? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await deletePath(entry.path);
      await refreshFileTree();

      if (selectedPath === entry.path) {
        setSelectedPath(null);
      }

      if (renamingPath === entry.path) {
        setRenamingPath(null);
        setRenameDraft("");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete path");
    } finally {
      setIsBusy(false);
    }
  };

  const handleBeginRename = (entry: FileEntry) => {
    setError(null);
    setCreateMode(null);
    setCreateName("");
    setRenamingPath(entry.path);
    setRenameDraft(entry.name);
    setSelectedPath(entry.path);
  };

  const handleSubmitRename = async () => {
    if (!workspacePath || !renamingPath || isBusy) {
      return;
    }

    const original = findEntryByPath(fileTree, renamingPath);
    if (!original) {
      setRenamingPath(null);
      setRenameDraft("");
      return;
    }

    const nextName = renameDraft.trim();
    if (!isValidName(nextName)) {
      setError("Invalid name. Avoid special characters and empty names.");
      return;
    }

    if (!original.is_dir && isHttpLikeFile(original.name) && !isHttpLikeFile(nextName)) {
      setError("Request files must keep a .http or .rest extension.");
      return;
    }

    if (nextName === original.name) {
      setRenamingPath(null);
      setRenameDraft("");
      return;
    }

    const parentPath = getParentPath(original.path);
    const siblingNames = listSiblingNames(fileTree, parentPath);
    siblingNames.delete(original.name.toLowerCase());
    if (siblingNames.has(nextName.toLowerCase())) {
      setError("A file or folder with that name already exists.");
      return;
    }

    const targetPath = joinPath(parentPath, nextName);

    setError(null);
    setIsBusy(true);
    try {
      await renamePath(original.path, targetPath);
      setRenamingPath(null);
      setRenameDraft("");
      setSelectedPath(targetPath);
      await refreshFileTree();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename path");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCancelRename = () => {
    setRenamingPath(null);
    setRenameDraft("");
  };

  if (!workspacePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-muted-foreground">No workspace open.</p>
        <OpenWorkspaceDialog />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!createParentPath || isBusy}
          aria-label="New file"
          title="New file"
          onClick={() => {
            if (!createParentPath) {
              return;
            }
            startCreate({ type: "file", parentPath: createParentPath });
          }}
        >
          <IconFilePlus className="size-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!createParentPath || isBusy}
          aria-label="New folder"
          title="New folder"
          onClick={() => {
            if (!createParentPath) {
              return;
            }
            startCreate({ type: "folder", parentPath: createParentPath });
          }}
        >
          <IconFolderPlus className="size-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isBusy}
          aria-label="Refresh"
          title="Refresh"
          onClick={() => {
            void handleRefresh();
          }}
        >
          <IconRefresh className={cn("size-3.5", isBusy && "animate-spin")} />
        </Button>
      </div>

      {createMode ? (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Input
            value={createName}
            autoFocus
            className="h-6"
            onChange={(event) => {
              setCreateName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCreateSubmit();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                cancelCreate();
              }
            }}
          />
          <Button
            type="button"
            size="xs"
            disabled={isBusy}
            onClick={() => {
              void handleCreateSubmit();
            }}
          >
            Create
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isBusy}
            onClick={cancelCreate}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-border px-2 py-1.5 text-xs text-destructive">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {fileTree.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No files found.</div>
        ) : (
          fileTree.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              activeFilePath={activeFilePath}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              renameDraft={renameDraft}
              onSelect={(nextEntry) => {
                setSelectedPath(nextEntry.path);
              }}
              onOpenFile={(path) => {
                void handleOpenFile(path);
              }}
              onCreateFile={(parentPath) => {
                startCreateAtPath("file", parentPath);
              }}
              onCreateFolder={(parentPath) => {
                startCreateAtPath("folder", parentPath);
              }}
              onBeginRename={handleBeginRename}
              onRenameDraftChange={setRenameDraft}
              onSubmitRename={() => {
                void handleSubmitRename();
              }}
              onCancelRename={handleCancelRename}
              onDelete={(entryToDelete) => {
                void handleDelete(entryToDelete);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

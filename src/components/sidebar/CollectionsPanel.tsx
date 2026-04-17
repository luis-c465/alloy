import {
  IconFilePlus,
  IconFolderPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { Fragment, useMemo, useState } from "react";

import type { FileEntry } from "~/bindings";
import { OpenWorkspaceDialog } from "~/components/workspace/OpenWorkspaceDialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  createDirectory,
  createHttpFile,
  deletePath,
  getFolderConfig,
  readHttpFile,
  renamePath,
} from "~/lib/api";
import { useFileTree } from "~/hooks/useFileTree";
import {
  INVALID_NAME_PATTERN,
  getParentPath,
  isHttpLikeFile,
  joinPath,
} from "~/lib/path";
import { cn } from "~/lib/utils";
import { FILE_TREE_INITIAL_EXPANSION_DEPTH } from "~/lib/constants";
import { useRequestStore } from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

import { FileTreeContextProvider, type PendingCreation } from "./FileTreeContext";
import { FileTreeNode } from "./FileTreeNode";
import { PendingCreationRow } from "./PendingCreationRow";

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
  const fallbackFileTree = useWorkspaceStore((state) => state.fileTree);
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const expandedState = useWorkspaceStore((state) => state.expandedState);
  const setSelectedPath = useWorkspaceStore((state) => state.setSelectedPath);
  const setPathExpanded = useWorkspaceStore((state) => state.setPathExpanded);
  const fileTreeQuery = useFileTree(workspacePath);
  const fileTree = fileTreeQuery.data ?? fallbackFileTree;

  const focusOrOpenRequestInTab = useRequestStore((state) => state.focusOrOpenRequestInTab);
  const openFolderTab = useRequestStore((state) => state.openFolderTab);
  const activeFilePath = useRequestStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.filePath ?? null,
  );

  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<FileEntry | null>(null);

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

  const startCreate = (mode: { type: "file" | "folder"; parentPath: string }) => {
    setError(null);
    setRenamingPath(null);
    setRenameDraft("");

    if (mode.parentPath !== workspacePath) {
      setPathExpanded(mode.parentPath, true);
    }

    setPendingCreation({
      type: mode.type,
      parentPath: mode.parentPath,
      name: mode.type === "file" ? "new-request.http" : "new-folder",
    });
  };

  const startCreateAtPath = (type: "file" | "folder", parentPath: string) => {
    startCreate({ type, parentPath });
  };

  const cancelCreate = () => {
    setPendingCreation(null);
  };

  const handleRefresh = async () => {
    if (!workspacePath || isBusy) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await fileTreeQuery.refetch();
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
        void focusOrOpenRequestInTab(request, path, index);
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open file");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!workspacePath || !pendingCreation || isBusy) {
      return;
    }

    const rawName = pendingCreation.name.trim();
    if (!isValidName(rawName)) {
      setError("Invalid name. Avoid special characters and empty names.");
      return;
    }

    if (pendingCreation.type === "file" && !rawName.toLowerCase().endsWith(".http")) {
      setError("New files must use the .http extension.");
      return;
    }

    const siblingNames = listSiblingNames(fileTree, pendingCreation.parentPath);
    if (siblingNames.has(rawName.toLowerCase())) {
      setError("A file or folder with that name already exists.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      if (pendingCreation.type === "file") {
        await createHttpFile(pendingCreation.parentPath, rawName);
      } else {
        await createDirectory(pendingCreation.parentPath, rawName);
      }

      cancelCreate();
      await fileTreeQuery.refetch();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : `Failed to create ${pendingCreation.type}`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    if (isBusy) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await deletePath(entry.path);
      await fileTreeQuery.refetch();

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
      setPendingDeleteEntry(null);
    }
  };

  const handleRequestDelete = (entry: FileEntry) => {
    setPendingDeleteEntry(entry);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteEntry) {
      return;
    }

    await handleDelete(pendingDeleteEntry);
  };

  const handleBeginRename = (entry: FileEntry) => {
    setError(null);
    setPendingCreation(null);
    setRenamingPath(entry.path);
    setRenameDraft(entry.name);
    setSelectedPath(entry.path);
  };

  const handleEditFolderProperties = async (entry: FileEntry) => {
    if (!workspacePath || isBusy || !entry.is_dir) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const config = await getFolderConfig(workspacePath, entry.path);
      await openFolderTab(entry.path, config);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open folder properties");
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggleDirectory = (path: string, expanded: boolean) => {
    setPathExpanded(path, expanded);
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
      await fileTreeQuery.refetch();
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

  const handlePendingNameChange = (value: string) => {
    setPendingCreation((current) => {
      if (!current) {
        return current;
      }

      return { ...current, name: value };
    });
  };

  const handleSubmitCreate = () => {
    void handleCreateSubmit();
  };

  const selectedRootIndex = useMemo(() => {
    if (!selectedPath) {
      return -1;
    }

    return fileTree.findIndex((entry) => entry.path === selectedPath);
  }, [fileTree, selectedPath]);

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

      {error ? (
        <div className="border-b border-border px-2 py-1.5 text-xs text-destructive">{error}</div>
      ) : null}

      <Dialog
        open={pendingDeleteEntry !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              Delete {pendingDeleteEntry ? `"${pendingDeleteEntry.name}"` : "the selected"}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => {
                setPendingDeleteEntry(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              onClick={() => {
                void handleConfirmDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FileTreeContextProvider
        activeFilePath={activeFilePath}
        selectedPath={selectedPath}
        expandedState={expandedState}
        isBusy={isBusy}
        renamingPath={renamingPath}
        renameDraft={renameDraft}
        pendingCreation={pendingCreation}
        onSelect={(entryToSelect) => {
          setSelectedPath(entryToSelect.path);
        }}
        onToggleDirectory={handleToggleDirectory}
        onOpenFile={(path) => {
          void handleOpenFile(path);
        }}
        onCreateFile={(parentPath) => {
          startCreateAtPath("file", parentPath);
        }}
        onCreateFolder={(parentPath) => {
          startCreateAtPath("folder", parentPath);
        }}
        onPendingNameChange={handlePendingNameChange}
        onSubmitCreate={handleSubmitCreate}
        onCancelCreate={cancelCreate}
        onBeginRename={handleBeginRename}
        onRenameDraftChange={setRenameDraft}
        onSubmitRename={() => {
          void handleSubmitRename();
        }}
        onCancelRename={handleCancelRename}
        onDelete={(entryToDelete) => {
          handleRequestDelete(entryToDelete);
        }}
        onEditFolderProperties={(entryToEdit) => {
          void handleEditFolderProperties(entryToEdit);
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {fileTree.length === 0 && !pendingCreation ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No files found.</div>
          ) : (
            <>
              {pendingCreation?.parentPath === workspacePath &&
              (fileTree.length === 0 || selectedRootIndex < 0) ? (
                <PendingCreationRow
                  type={pendingCreation.type}
                  name={pendingCreation.name}
                  depth={0}
                  isBusy={isBusy}
                  onNameChange={handlePendingNameChange}
                  onSubmit={handleSubmitCreate}
                  onCancel={cancelCreate}
                />
              ) : null}

              {fileTree.map((entry, index) => (
                <Fragment key={entry.path}>
                  <FileTreeNode
                    entry={entry}
                    depth={0}
                    defaultExpanded={0 < FILE_TREE_INITIAL_EXPANSION_DEPTH}
                  />

                  {pendingCreation?.parentPath === workspacePath && index === selectedRootIndex ? (
                    <PendingCreationRow
                      type={pendingCreation.type}
                      name={pendingCreation.name}
                      depth={0}
                      isBusy={isBusy}
                      onNameChange={handlePendingNameChange}
                      onSubmit={handleSubmitCreate}
                      onCancel={cancelCreate}
                    />
                  ) : null}
                </Fragment>
              ))}
            </>
          )}
        </div>
      </FileTreeContextProvider>
    </div>
  );
}

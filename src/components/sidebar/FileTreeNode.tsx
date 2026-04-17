import {
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import type { FileEntry } from "~/bindings";
import { Input } from "~/components/ui/input";
import { FILE_TREE_INITIAL_EXPANSION_DEPTH } from "~/lib/constants";
import { isHttpLikeFile } from "~/lib/path";
import { cn } from "~/lib/utils";

import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { useFileTreeContext } from "./FileTreeContext";
import { PendingCreationRow } from "./PendingCreationRow";

type FileTreeNodeProps = {
  entry: FileEntry;
  depth: number;
  defaultExpanded: boolean;
};

export const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
  defaultExpanded,
}: FileTreeNodeProps) {
  const [contextMenuPosition, setContextMenuPosition] =
    useState<{ x: number; y: number } | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    activeFilePath,
    selectedPath,
    expandedState,
    isBusy,
    renamingPath,
    renameDraft,
    pendingCreation,
    onSelect,
    onToggleDirectory,
    onOpenFile,
    onCreateFile,
    onCreateFolder,
    onPendingNameChange,
    onSubmitCreate,
    onCancelCreate,
    onBeginRename,
    onRenameDraftChange,
    onSubmitRename,
    onCancelRename,
    onDelete,
    onEditFolderProperties,
  } = useFileTreeContext();

  const isDirectory = entry.is_dir;
  const isRenaming = renamingPath === entry.path;
  const canOpen = !isDirectory && isHttpLikeFile(entry.name);
  const isActiveFile = !isDirectory && activeFilePath === entry.path;
  const isSelected = selectedPath === entry.path;
  const isExpanded = isDirectory ? (expandedState[entry.path] ?? defaultExpanded) : false;
  const children = useMemo(() => entry.children ?? [], [entry.children]);
  const pendingCreationChild = pendingCreation?.parentPath === entry.path ? pendingCreation : null;

  useEffect(() => {
    if (!isSelected) {
      return;
    }

    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    onSelect(entry);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setIsContextMenuOpen(true);
  };

  useHotkey(
    "Enter",
    (event: KeyboardEvent) => {
      event.preventDefault();
      onSubmitRename();
    },
    {
      enabled: isRenaming,
      target: renameInputRef,
      ignoreInputs: false,
    },
  );

  useHotkey(
    "Escape",
    (event: KeyboardEvent) => {
      event.preventDefault();
      onCancelRename();
    },
    {
      enabled: isRenaming,
      target: renameInputRef,
      ignoreInputs: false,
    },
  );

  return (
    <div className="min-w-0">
      <div
        ref={rowRef}
        className={cn(
          "group/tree-row relative flex h-7 min-w-0 items-center rounded-sm text-xs",
          isSelected && "bg-muted/50",
          isActiveFile && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDirectory ? (
          <button
            type="button"
            className="mr-0.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-muted"
              onClick={() => {
                onToggleDirectory(entry.path, !isExpanded);
              }}
              onContextMenu={handleContextMenu}
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            <IconChevronRight
              className={cn("size-3 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="mr-0.5 inline-flex size-4" />
        )}

        {isRenaming ? (
          <Input
            ref={renameInputRef}
            value={renameDraft}
            autoFocus
            className="h-6 w-full"
            onChange={(event) => {
              onRenameDraftChange(event.target.value);
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onContextMenu={handleContextMenu}
            onBlur={() => {
              onSubmitRename();
            }}
          />
        ) : (
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-muted",
              !isDirectory && !canOpen && "text-muted-foreground",
            )}
            onContextMenu={handleContextMenu}
            onClick={() => {
              onSelect(entry);

              if (isDirectory) {
                onToggleDirectory(entry.path, !isExpanded);
                return;
              }

              if (canOpen) {
                onOpenFile(entry.path);
              }
            }}
          >
            {isDirectory ? (
              isExpanded ? (
                <IconFolderOpen className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <IconFolder className="size-3.5 shrink-0 text-amber-500" />
              )
            ) : canOpen ? (
              <IconFileCode className="size-3.5 shrink-0" />
            ) : (
              <IconFile className="size-3.5 shrink-0" />
            )}

            <span className="truncate">{entry.name}</span>
          </button>
        )}

        <FileTreeContextMenu
          isDirectory={isDirectory}
          canOpen={canOpen}
          open={isContextMenuOpen}
          position={contextMenuPosition}
          onOpenChange={(open) => {
            setIsContextMenuOpen(open);
            if (!open) {
              setContextMenuPosition(null);
            }
          }}
          onOpen={() => {
            if (canOpen) {
              onOpenFile(entry.path);
            }
          }}
          onNewFile={() => {
            if (isDirectory) {
              onCreateFile(entry.path);
            }
          }}
          onNewFolder={() => {
            if (isDirectory) {
              onCreateFolder(entry.path);
            }
          }}
          onRename={() => {
            onBeginRename(entry);
          }}
          onDelete={() => {
            onDelete(entry);
          }}
          onEditFolderProperties={() => {
            if (isDirectory) {
              onEditFolderProperties(entry);
            }
          }}
        />
      </div>

      {isDirectory && isExpanded && (children.length > 0 || pendingCreationChild) ? (
        <div>
          {pendingCreationChild ? (
            <PendingCreationRow
              type={pendingCreationChild.type}
              name={pendingCreationChild.name}
              depth={depth + 1}
              isBusy={isBusy}
              onNameChange={onPendingNameChange}
              onSubmit={onSubmitCreate}
              onCancel={onCancelCreate}
            />
          ) : null}
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              defaultExpanded={depth + 1 < FILE_TREE_INITIAL_EXPANSION_DEPTH}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

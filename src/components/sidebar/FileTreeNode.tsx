import {
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { memo, useMemo, useRef, useState, type MouseEvent } from "react";

import type { FileEntry } from "~/bindings";
import { Input } from "~/components/ui/input";
import { FILE_TREE_INITIAL_EXPANSION_DEPTH } from "~/lib/constants";
import { isHttpLikeFile } from "~/lib/path";
import { cn } from "~/lib/utils";

import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { useFileTreeContext } from "./FileTreeContext";

type FileTreeNodeProps = {
  entry: FileEntry;
  depth: number;
};

export const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
}: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(
    depth < FILE_TREE_INITIAL_EXPANSION_DEPTH,
  );
  const [contextMenuPosition, setContextMenuPosition] =
    useState<{ x: number; y: number } | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    activeFilePath,
    selectedPath,
    renamingPath,
    renameDraft,
    onSelect,
    onOpenFile,
    onCreateFile,
    onCreateFolder,
    onBeginRename,
    onRenameDraftChange,
    onSubmitRename,
    onCancelRename,
    onDelete,
  } = useFileTreeContext();

  const isDirectory = entry.is_dir;
  const isRenaming = renamingPath === entry.path;
  const canOpen = !isDirectory && isHttpLikeFile(entry.name);
  const isActiveFile = !isDirectory && activeFilePath === entry.path;
  const isSelected = selectedPath === entry.path;
  const children = useMemo(() => entry.children ?? [], [entry.children]);

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
              setIsExpanded((current) => !current);
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
                setIsExpanded((current) => !current);
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
        />
      </div>

      {isDirectory && isExpanded && children.length > 0 ? (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

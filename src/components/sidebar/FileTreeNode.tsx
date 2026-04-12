import {
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { useMemo, useState, type MouseEvent } from "react";

import type { FileEntry } from "~/bindings";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import { FileTreeContextMenu } from "./FileTreeContextMenu";

type FileTreeNodeProps = {
  entry: FileEntry;
  depth: number;
  activeFilePath: string | null;
  selectedPath: string | null;
  renamingPath: string | null;
  renameDraft: string;
  onSelect: (entry: FileEntry) => void;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onBeginRename: (entry: FileEntry) => void;
  onRenameDraftChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onDelete: (entry: FileEntry) => void;
};

const isHttpLikeFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".http") || lower.endsWith(".rest");
};

export function FileTreeNode({
  entry,
  depth,
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
}: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [contextMenuPosition, setContextMenuPosition] =
    useState<{ x: number; y: number } | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitRename();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
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
              activeFilePath={activeFilePath}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              renameDraft={renameDraft}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onBeginRename={onBeginRename}
              onRenameDraftChange={onRenameDraftChange}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

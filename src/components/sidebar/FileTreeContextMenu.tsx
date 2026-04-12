import type { CSSProperties } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type FileTreeContextMenuProps = {
  isDirectory: boolean;
  canOpen: boolean;
  open: boolean;
  position: { x: number; y: number } | null;
  onOpenChange: (open: boolean) => void;
  onOpen: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
};

export function FileTreeContextMenu({
  isDirectory,
  canOpen,
  open,
  position,
  onOpenChange,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: FileTreeContextMenuProps) {
  const triggerStyle: CSSProperties = position
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }
    : {
        position: "fixed",
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-hidden tabIndex={-1} style={triggerStyle} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-40">
        {!isDirectory ? (
          <DropdownMenuItem
            disabled={!canOpen}
            onSelect={() => {
              onOpen();
            }}
          >
            Open
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => {
                onNewFile();
              }}
            >
              New File
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onNewFolder();
              }}
            >
              New Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          onSelect={() => {
            onRename();
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            onDelete();
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

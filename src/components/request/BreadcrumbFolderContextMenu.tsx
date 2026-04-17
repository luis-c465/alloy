import type { CSSProperties } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type BreadcrumbFolderContextMenuProps = {
  open: boolean;
  position: { x: number; y: number } | null;
  onOpenChange: (open: boolean) => void;
  onFolderProperties: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
};

export function BreadcrumbFolderContextMenu({
  open,
  position,
  onOpenChange,
  onFolderProperties,
  onNewFile,
  onNewFolder,
}: BreadcrumbFolderContextMenuProps) {
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

      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onSelect={onFolderProperties}>
          Folder Properties
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewFile}>New File</DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewFolder}>New Folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

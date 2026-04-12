import {
  IconChevronDown,
  IconFolder,
  IconLayoutSidebar,
  IconSettings,
} from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type ToolbarProps = {
  workspaceName: string | null;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Toolbar({
  workspaceName,
  isSidebarCollapsed,
  onToggleSidebar,
}: ToolbarProps) {
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant={isSidebarCollapsed ? "outline" : "ghost"}
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <IconLayoutSidebar />
        </Button>

        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <IconFolder className="size-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">
            {workspaceName ?? "No Workspace"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7">
              Env: None
              <IconChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem disabled>No environments yet</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
        >
          <IconSettings />
        </Button>
      </div>
    </header>
  );
}

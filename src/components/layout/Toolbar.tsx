import {
  IconChevronDown,
  IconFolder,
  IconFolderOpen,
  IconLayoutSidebar,
  IconSettings,
} from "@tabler/icons-react";

import { OpenWorkspaceDialog } from "~/components/workspace/OpenWorkspaceDialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useWorkspaceStore } from "~/stores/workspace-store";

type ToolbarProps = {
  workspaceName?: string | null;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Toolbar({
  workspaceName,
  isSidebarCollapsed,
  onToggleSidebar,
}: ToolbarProps) {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const workspaceNameFromStore = useWorkspaceStore((state) => state.workspaceName);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);

  const activeWorkspaceName = workspaceName ?? workspaceNameFromStore;

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
            {activeWorkspaceName ?? "No Workspace"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {workspacePath ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7">
                <IconFolderOpen className="size-3.5" />
                Workspace
                <IconChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <OpenWorkspaceDialog>
                {({ openWorkspace, isOpening }) => (
                  <DropdownMenuItem
                    disabled={isOpening}
                    onSelect={() => {
                      void openWorkspace();
                    }}
                  >
                    Open Workspace
                  </DropdownMenuItem>
                )}
              </OpenWorkspaceDialog>
              <DropdownMenuItem
                onSelect={() => {
                  setWorkspace(null);
                  setFileTree([]);
                }}
              >
                Close Workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <OpenWorkspaceDialog label="Open Workspace" />
        )}

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

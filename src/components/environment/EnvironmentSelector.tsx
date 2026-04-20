import { lazy, Suspense, useMemo, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useEnvironments } from "~/hooks/useEnvironments";
import { setActiveEnvironment as setActiveEnvironmentApi } from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

const EnvironmentEditor = lazy(() => import("~/components/environment/EnvironmentEditor")
  .then((module) => ({ default: module.EnvironmentEditor })));

export function EnvironmentSelector() {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);

  const [editorOpen, setEditorOpen] = useState(false);
  const environmentsQuery = useEnvironments(workspacePath);

  const activeLabel = useMemo(() => {
    if (!workspacePath) {
      return "No Workspace";
    }

    return activeEnvironment ?? "No Environment";
  }, [activeEnvironment, workspacePath]);

  const handleSwitchEnvironment = async (name: string | null) => {
    if (!workspacePath) {
      return;
    }

    const previous = activeEnvironment;
    setActiveEnvironment(name);

    try {
      await setActiveEnvironmentApi(workspacePath, name);
    } catch {
      setActiveEnvironment(previous);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={!workspacePath}
          >
            Env: {activeLabel}
            <IconChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          {environments.length > 0 ? (
            environments.map((environment) => (
              <DropdownMenuItem
                key={environment.name}
                onSelect={() => {
                  void handleSwitchEnvironment(environment.name);
                }}
              >
                {environment.name}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No environments</DropdownMenuItem>
          )}

          <DropdownMenuItem
            onSelect={() => {
              void handleSwitchEnvironment(null);
            }}
          >
            No Environment
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => {
              setEditorOpen(true);
            }}
            disabled={!workspacePath}
          >
            Manage Environments
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Suspense fallback={null}>
        <EnvironmentEditor
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) {
              void environmentsQuery.refetch();
            }
          }}
        />
      </Suspense>
    </>
  );
}

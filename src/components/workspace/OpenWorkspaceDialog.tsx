import { useCallback, useState, type ReactNode } from "react";
import { IconFolderOpen } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import { ensureWorkspace, pickWorkspaceFolder } from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

type OpenWorkspaceDialogProps = {
  children?: (args: {
    openWorkspace: () => Promise<void>;
    isOpening: boolean;
  }) => ReactNode;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
};

export function OpenWorkspaceDialog({
  children,
  label = "Open Workspace",
  variant = "outline",
  size = "sm",
  className,
}: OpenWorkspaceDialogProps) {
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const [isOpening, setIsOpening] = useState(false);

  const openWorkspace = useCallback(async () => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      const path = await pickWorkspaceFolder();

      if (!path) {
        return;
      }

      await ensureWorkspace(path);
      await setWorkspace(path);
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, setWorkspace]);

  if (children) {
    return children({ openWorkspace, isOpening });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        void openWorkspace();
      }}
      disabled={isOpening}
      aria-label="Open workspace"
    >
      <IconFolderOpen className="size-3.5" />
      {label}
    </Button>
  );
}

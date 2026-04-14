import * as React from "react";
import { IconGripVertical } from "@tabler/icons-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "~/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel(props: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  className,
  withHandle,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border/70",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "[&[aria-orientation=vertical]]:h-px [&[aria-orientation=vertical]]:w-full",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-background text-muted-foreground">
          <IconGripVertical className="size-2.5" />
        </div>
      ) : null}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

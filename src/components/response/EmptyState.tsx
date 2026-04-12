import { IconSend } from "@tabler/icons-react";

export function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <IconSend className="size-6 opacity-70" />
        <p className="text-sm">Send a request to see the response</p>
      </div>
    </div>
  );
}

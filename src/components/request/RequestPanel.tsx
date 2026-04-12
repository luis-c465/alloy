import { MethodSelector } from "~/components/request/MethodSelector";
import { SendButton } from "~/components/request/SendButton";
import { UrlBar } from "~/components/request/UrlBar";

export function RequestPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <MethodSelector />
        <UrlBar />
        <SendButton />
      </div>

      <div className="flex-1 border-t border-border p-3 text-sm text-muted-foreground">
        Request details tabs will appear here in Step 6.
      </div>
    </div>
  );
}

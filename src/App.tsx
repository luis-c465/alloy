import { useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { RequestPanel } from "~/components/request/RequestPanel";
import { ResponsePanel } from "~/components/response/ResponsePanel";
import { useRequestStore } from "~/stores/request-store";

export default function App() {
  useEffect(() => {
    const handleGlobalSend = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      event.preventDefault();
      void useRequestStore.getState().sendRequest();
    };

    window.addEventListener("keydown", handleGlobalSend);

    return () => {
      window.removeEventListener("keydown", handleGlobalSend);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <PanelGroup orientation="vertical" className="h-full w-full">
        <Panel minSize={30} defaultSize={50}>
          <RequestPanel />
        </Panel>

        <PanelResizeHandle className="h-1.5 cursor-row-resize border-y border-border/80 bg-border/70 shadow-sm transition-colors hover:bg-primary/20" />

        <Panel minSize={20} defaultSize={50}>
          <ResponsePanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}

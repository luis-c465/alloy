import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { RequestPanel } from "~/components/request/RequestPanel";
import { ResponsePanel } from "~/components/response/ResponsePanel";

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <PanelGroup orientation="vertical" className="h-full w-full">
        <Panel minSize={30} defaultSize={50}>
          <RequestPanel />
        </Panel>

        <PanelResizeHandle className="h-1 cursor-row-resize bg-border transition-colors hover:bg-primary/20" />

        <Panel minSize={20} defaultSize={50}>
          <ResponsePanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}

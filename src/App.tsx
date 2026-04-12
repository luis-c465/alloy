import { useCallback, useEffect, useRef, useState } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";
import { Sidebar } from "~/components/layout/Sidebar";
import { TabBar } from "~/components/layout/TabBar";
import { Toolbar } from "~/components/layout/Toolbar";
import { RequestPanel } from "~/components/request/RequestPanel";
import { ResponsePanel } from "~/components/response/ResponsePanel";
import { useRequestStore } from "~/stores/request-store";

export default function App() {
  const sidebarPanelRef = usePanelRef();
  const outerLayout = useDefaultLayout({
    id: "layout-horizontal",
    storage: window.localStorage,
  });
  const innerLayout = useDefaultLayout({
    id: "layout-vertical",
    storage: window.localStorage,
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const isAutoCollapsingRef = useRef(false);

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

  const collapseSidebar = useCallback(() => {
    if (sidebarPanelRef.current?.isCollapsed()) {
      return;
    }

    sidebarPanelRef.current?.collapse();
  }, [sidebarPanelRef]);

  const toggleSidebar = useCallback(() => {
    isAutoCollapsingRef.current = false;

    if (sidebarPanelRef.current?.isCollapsed()) {
      sidebarPanelRef.current?.expand();
      return;
    }

    sidebarPanelRef.current?.collapse();
  }, [sidebarPanelRef]);

  const handleOuterLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      outerLayout.onLayoutChanged(layout);

      if (window.innerWidth < 800) {
        isAutoCollapsingRef.current = true;
        collapseSidebar();
      }
    },
    [collapseSidebar, outerLayout],
  );

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 800) {
        isAutoCollapsingRef.current = true;
        collapseSidebar();
        return;
      }

      if (
        isAutoCollapsingRef.current
        && sidebarPanelRef.current?.isCollapsed()
      ) {
        sidebarPanelRef.current?.expand();
      }

      isAutoCollapsingRef.current = false;
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [collapseSidebar, sidebarPanelRef]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar
        workspaceName={null}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />

      <PanelGroup
        orientation="horizontal"
        className="h-full w-full"
        defaultLayout={outerLayout.defaultLayout}
        onLayoutChanged={handleOuterLayoutChanged}
      >
        <Panel
          panelRef={sidebarPanelRef}
          minSize="10%"
          defaultSize="20%"
          collapsible
          collapsedSize="0%"
          onResize={(size) => {
            setIsSidebarCollapsed(size.asPercentage <= 0.5);
          }}
          className="border-r border-border"
        >
          <Sidebar />
        </Panel>

        <PanelResizeHandle
          className="w-1.5 cursor-col-resize border-x border-border/80 bg-border/70 shadow-sm transition-colors hover:bg-primary/20"
          onDoubleClick={toggleSidebar}
        />

        <Panel minSize="45%">
          <div className="flex h-full min-h-0 flex-col">
            <TabBar />

            <PanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
              defaultLayout={innerLayout.defaultLayout}
              onLayoutChanged={innerLayout.onLayoutChanged}
            >
              <Panel minSize="30%" defaultSize="50%">
                <RequestPanel />
              </Panel>

              <PanelResizeHandle className="h-1.5 cursor-row-resize border-y border-border/80 bg-border/70 shadow-sm transition-colors hover:bg-primary/20" />

              <Panel minSize="20%" defaultSize="50%">
                <ResponsePanel />
              </Panel>
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

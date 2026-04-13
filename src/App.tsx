import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";
import { Sidebar } from "~/components/layout/Sidebar";
import { ShortcutPalette } from "~/components/layout/ShortcutPalette";
import { TabBar } from "~/components/layout/TabBar";
import { Toolbar } from "~/components/layout/Toolbar";
import { RequestPanel } from "~/components/request/RequestPanel";
import { ResponsePanel } from "~/components/response/ResponsePanel";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { useShortcuts } from "~/hooks/useShortcuts";
import {
  registerDirtyTabPromptHandler,
  registerSaveAsHandler,
  type DirtyTabDecision,
  type Tab,
  useRequestStore,
} from "~/stores/request-store";
import { useThemeStore } from "~/stores/theme-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type DirtyPromptState =
  | {
    mode: "tab";
    tab: Tab;
    resolve: (decision: DirtyTabDecision) => void;
  }
  | {
    mode: "app";
    tabCount: number;
    resolve: (decision: DirtyTabDecision) => void;
  }
  | null;

type SaveAsState = {
  tab: Tab;
  path: string;
  resolve: (path: string | null) => void;
} | null;

const sanitizeFileName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

  const baseName = normalized || "request";
  return baseName.endsWith(".http") ? baseName : `${baseName}.http`;
};

const getPathSeparator = (path: string): string => (
  path.includes("\\") && !path.includes("/") ? "\\" : "/"
);

const joinPath = (basePath: string, segment: string): string => {
  const separator = getPathSeparator(basePath);
  return basePath.endsWith("/") || basePath.endsWith("\\")
    ? `${basePath}${segment}`
    : `${basePath}${separator}${segment}`;
};

const buildDefaultSavePath = (tab: Tab, workspacePath: string | null): string => {
  if (tab.filePath) {
    return tab.filePath;
  }

  const fileName = sanitizeFileName(tab.requestName ?? tab.name);
  return workspacePath ? joinPath(workspacePath, fileName) : fileName;
};

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
  const [dirtyPromptState, setDirtyPromptState] = useState<DirtyPromptState>(null);
  const [saveAsState, setSaveAsState] = useState<SaveAsState>(null);
  const [isShortcutPaletteOpen, setIsShortcutPaletteOpen] = useState(false);
  const allowWindowCloseRef = useRef(false);
  const initTheme = useThemeStore((state) => state.initTheme);

  const openShortcutPalette = useCallback(() => {
    setIsShortcutPaletteOpen(true);
  }, []);

  const closeShortcutPalette = useCallback(() => {
    setIsShortcutPaletteOpen(false);
  }, []);

  useShortcuts({
    isPaletteOpen: isShortcutPaletteOpen,
    onOpenPalette: openShortcutPalette,
    onClosePalette: closeShortcutPalette,
  });

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const unregisterDirtyPrompt = registerDirtyTabPromptHandler(
      async (tab) => new Promise<DirtyTabDecision>((resolve) => {
        setDirtyPromptState({ mode: "tab", tab, resolve });
      }),
    );
    const unregisterSaveAs = registerSaveAsHandler(
      async (tab) => new Promise<string | null>((resolve) => {
        setSaveAsState({
          tab,
          path: buildDefaultSavePath(tab, useWorkspaceStore.getState().workspacePath),
          resolve,
        });
      }),
    );

    return () => {
      unregisterDirtyPrompt();
      unregisterSaveAs();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void getCurrentWindow().onCloseRequested(async (event) => {
      if (allowWindowCloseRef.current) {
        allowWindowCloseRef.current = false;
        return;
      }

      const dirtyTabs = useRequestStore.getState().tabs.filter((tab) => tab.isDirty);
      if (dirtyTabs.length === 0) {
        return;
      }

      event.preventDefault();

      const decision = await new Promise<DirtyTabDecision>((resolve) => {
        setDirtyPromptState({
          mode: "app",
          tabCount: dirtyTabs.length,
          resolve,
        });
      });

      if (decision === "cancel") {
        return;
      }

      if (decision === "save") {
        for (const tab of dirtyTabs) {
          const saved = await useRequestStore.getState().saveTab(tab.id);
          if (!saved) {
            return;
          }
        }
      }

      allowWindowCloseRef.current = true;
      await getCurrentWindow().close();
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const resolveDirtyPrompt = useCallback((decision: DirtyTabDecision) => {
    setDirtyPromptState((currentState) => {
      currentState?.resolve(decision);
      return null;
    });
  }, []);

  const resolveSaveAs = useCallback((path: string | null) => {
    setSaveAsState((currentState) => {
      currentState?.resolve(path);
      return null;
    });
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

      <Dialog
        open={dirtyPromptState !== null}
        onOpenChange={(open) => {
          if (!open && dirtyPromptState) {
            resolveDirtyPrompt("cancel");
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dirtyPromptState?.mode === "app"
                ? "Save changes before closing?"
                : `Save changes to ${dirtyPromptState?.tab.name || "this request"}?`}
            </DialogTitle>
            <DialogDescription>
              {dirtyPromptState?.mode === "app"
                ? `You have ${dirtyPromptState.tabCount} tab${dirtyPromptState.tabCount === 1 ? "" : "s"} with unsaved changes.`
                : "Your changes will be lost if you don’t save them first."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => resolveDirtyPrompt("cancel")}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => resolveDirtyPrompt("discard")}>
              Don&apos;t Save
            </Button>
            <Button onClick={() => resolveDirtyPrompt("save")}>
              {dirtyPromptState?.mode === "app" ? "Save All" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShortcutPalette
        open={isShortcutPaletteOpen}
        onOpenChange={setIsShortcutPaletteOpen}
      />

      <Dialog
        open={saveAsState !== null}
        onOpenChange={(open) => {
          if (!open && saveAsState) {
            resolveSaveAs(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Save Request As</DialogTitle>
            <DialogDescription>
              Choose where to save {saveAsState?.tab.name || "this request"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="save-request-path" className="text-xs font-medium text-foreground">
              File path
            </label>
            <Input
              id="save-request-path"
              value={saveAsState?.path ?? ""}
              onChange={(event) => {
                const nextPath = event.target.value;
                setSaveAsState((currentState) => (
                  currentState
                    ? { ...currentState, path: nextPath }
                    : currentState
                ));
              }}
              placeholder="/path/to/request.http"
              className="font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => resolveSaveAs(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const nextPath = saveAsState?.path.trim() ?? "";
                resolveSaveAs(nextPath || null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

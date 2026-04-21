import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { ScrollArea } from "~/components/ui/scroll-area";
import { useShortcuts } from "~/hooks/useShortcuts";
import { buildDefaultSavePath } from "~/lib/path";
import {
  registerDirtyTabPromptHandler,
  registerTabLimitPromptHandler,
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

type TabLimitPromptState = {
  candidates: Tab[];
  selectedTabId: string | null;
  resolve: (selectedTabId: string | null) => void;
} | null;

const CurlImportDialog = lazy(() => import("~/components/import-export/CurlImportDialog")
  .then((module) => ({ default: module.CurlImportDialog })));
const CurlExportDialog = lazy(() => import("~/components/import-export/CurlExportDialog")
  .then((module) => ({ default: module.CurlExportDialog })));
const PostmanImportDialog = lazy(() => import("~/components/import-export/PostmanImportDialog")
  .then((module) => ({ default: module.PostmanImportDialog })));
const OpenApiImportDialog = lazy(() => import("~/components/import-export/OpenApiImportDialog")
  .then((module) => ({ default: module.OpenApiImportDialog })));

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
  const [tabLimitPromptState, setTabLimitPromptState] = useState<TabLimitPromptState>(null);
  const [isShortcutPaletteOpen, setIsShortcutPaletteOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isPostmanImportDialogOpen, setIsPostmanImportDialogOpen] = useState(false);
  const [isOpenApiImportDialogOpen, setIsOpenApiImportDialogOpen] = useState(false);
  const allowWindowCloseRef = useRef(false);
  const initTheme = useThemeStore((state) => state.initTheme);
  const initWorkspace = useWorkspaceStore((state) => state.initWorkspace);

  const openShortcutPalette = useCallback(() => {
    setIsShortcutPaletteOpen(true);
  }, []);

  const closeShortcutPalette = useCallback(() => {
    setIsShortcutPaletteOpen(false);
  }, []);

  useShortcuts({
    onOpenPalette: openShortcutPalette,
    onClosePalette: closeShortcutPalette,
  });

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    void initWorkspace();
  }, [initWorkspace]);

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
          path: buildDefaultSavePath(
            tab.name,
            tab.requestName,
            tab.filePath,
            useWorkspaceStore.getState().workspacePath,
          ),
          resolve,
        });
      }),
    );
    const unregisterTabLimitPrompt = registerTabLimitPromptHandler(
      (tabs) => new Promise<string | null>((resolve) => {
        setTabLimitPromptState({
          candidates: tabs,
          selectedTabId: tabs[0]?.id ?? null,
          resolve,
        });
      }),
    );

    return () => {
      unregisterDirtyPrompt();
      unregisterSaveAs();
      unregisterTabLimitPrompt();
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
            window.alert(`Unable to save "${tab.name}". The app will remain open so you can resolve the issue.`);
            return;
          }
        }
      }

      allowWindowCloseRef.current = true;
      try {
        await getCurrentWindow().close();
      } catch (error) {
        allowWindowCloseRef.current = false;
        console.error("Failed to close window from close-request handler", error);
        window.alert("Unable to close the window due to missing permission or runtime error.");
      }
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

  const resolveTabLimitPrompt = useCallback((selectedTabId: string | null) => {
    setTabLimitPromptState((currentState) => {
      currentState?.resolve(selectedTabId);
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
        onOpenImportDialog={() => {
          setIsImportDialogOpen(true);
        }}
        onOpenExportDialog={() => {
          setIsExportDialogOpen(true);
        }}
        onOpenPostmanImportDialog={() => {
          setIsPostmanImportDialogOpen(true);
        }}
        onOpenOpenApiImportDialog={() => {
          setIsOpenApiImportDialogOpen(true);
        }}
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

      <Dialog
        open={tabLimitPromptState !== null}
        onOpenChange={(open) => {
          if (!open && tabLimitPromptState) {
            resolveTabLimitPrompt(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close a tab to continue</DialogTitle>
            <DialogDescription>
              Your tab limit has been reached. Choose a tab to close so the new tab can open.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-56 rounded-md border border-border bg-muted/10">
            <div className="space-y-1 p-2">
              {tabLimitPromptState?.candidates.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  No tabs are currently eligible to close.
                </p>
              ) : (
                tabLimitPromptState?.candidates.map((tab) => {
                  const isSelected = tabLimitPromptState?.selectedTabId === tab.id;
                  const methodLabel = tab.tabType === "folder" ? "FOLDER" : tab.method;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setTabLimitPromptState((currentState) => {
                          if (!currentState) {
                            return null;
                          }

                          return {
                            ...currentState,
                            selectedTabId: tab.id,
                          };
                        });
                      }}
                      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
                        {methodLabel}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {tab.name || tab.url || "New Request"}
                      </span>
                      {tab.isDirty ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => resolveTabLimitPrompt(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => resolveTabLimitPrompt(tabLimitPromptState?.selectedTabId ?? null)}
              disabled={!tabLimitPromptState?.selectedTabId}
            >
              Close selected tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShortcutPalette
        open={isShortcutPaletteOpen}
        onOpenChange={setIsShortcutPaletteOpen}
        onToggleSidebar={toggleSidebar}
        onOpenImportDialog={() => {
          setIsImportDialogOpen(true);
        }}
        onOpenExportDialog={() => {
          setIsExportDialogOpen(true);
        }}
        onOpenPostmanImportDialog={() => {
          setIsPostmanImportDialogOpen(true);
        }}
        onOpenOpenApiImportDialog={() => {
          setIsOpenApiImportDialogOpen(true);
        }}
      />

      <Suspense fallback={null}>
        <CurlImportDialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen} />
        <CurlExportDialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen} />
        <PostmanImportDialog
          open={isPostmanImportDialogOpen}
          onOpenChange={setIsPostmanImportDialogOpen}
        />
        <OpenApiImportDialog
          open={isOpenApiImportDialogOpen}
          onOpenChange={setIsOpenApiImportDialogOpen}
        />
      </Suspense>

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

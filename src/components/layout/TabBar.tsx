import { memo, useCallback, useEffect, useRef, type MouseEvent } from "react";
import { IconFolder, IconPlus, IconX } from "@tabler/icons-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "~/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { cn } from "~/lib/utils";
import { useRequestStore } from "~/stores/request-store";

const methodColorClasses: Record<string, string> = {
  GET: "bg-emerald-500",
  POST: "bg-amber-500",
  PUT: "bg-blue-500",
  PATCH: "bg-purple-500",
  DELETE: "bg-red-500",
  HEAD: "bg-zinc-500",
  OPTIONS: "bg-zinc-500",
};

type TabBarTab = {
  id: string;
  name: string;
  isDirty: boolean;
  method: string;
  tabType: "request" | "folder";
};

type TabItemProps = {
  tab: TabBarTab;
  isActive: boolean;
  hasTabsToRight: boolean;
  hasOtherTabs: boolean;
  onActivate: (tabId: string) => void;
  onMiddleMouseClose: (event: MouseEvent, tabId: string) => void;
  onClose: (event: MouseEvent | null, tabId: string) => void;
  onDuplicate: (tabId: string) => void;
  onSave: (tabId: string) => void;
  onSaveAs: (tabId: string) => void;
  onCloseTabsToRight: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  setTabButtonRef: (tabId: string, element: HTMLButtonElement | null) => void;
};

const TabItem = memo(function TabItem({
  tab,
  isActive,
  hasTabsToRight,
  hasOtherTabs,
  onActivate,
  onMiddleMouseClose,
  onClose,
  onDuplicate,
  onSave,
  onSaveAs,
  onCloseTabsToRight,
  onCloseOtherTabs,
  setTabButtonRef,
}: TabItemProps) {
  const method = tab.method.toUpperCase();
  const isFolderTab = tab.tabType === "folder";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative flex h-full max-w-[150px] min-w-[120px] items-stretch border-b-2 pr-1",
            isActive
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <button
            ref={(element) => {
              setTabButtonRef(tab.id, element);
            }}
            type="button"
            onClick={() => onActivate(tab.id)}
            onMouseDown={(event) => {
              onMiddleMouseClose(event, tab.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 pl-2 text-xs"
          >
            {isFolderTab ? (
              <IconFolder className="size-3 shrink-0 text-amber-500" />
            ) : (
              <>
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    methodColorClasses[method] ?? methodColorClasses.GET,
                  )}
                />

                <span className="shrink-0 text-[10px] font-semibold tracking-wide">
                  {method}
                </span>
              </>
            )}

            <span className="truncate text-left">{tab.name || "New Request"}</span>

            {tab.isDirty
              ? <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              : null}
          </button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Close ${tab.name || "tab"}`}
            className="my-auto size-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
            onClick={(event) => {
              onClose(event, tab.id);
            }}
          >
            <IconX className="size-3" />
          </Button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={isFolderTab}
            onSelect={() => {
              onDuplicate(tab.id);
            }}
          >
            Duplicate Tab
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              onSave(tab.id);
            }}
          >
            Save
            <ContextMenuShortcut>Mod+S</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={isFolderTab}
            onSelect={() => {
              onSaveAs(tab.id);
            }}
          >
            Save As...
            <ContextMenuShortcut>Shift+Mod+S</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() => {
              onClose(null, tab.id);
            }}
          >
            Close Tab
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasTabsToRight}
            onSelect={() => {
              onCloseTabsToRight(tab.id);
            }}
          >
            Close Tabs to the Right
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            disabled={!hasOtherTabs}
            onSelect={() => {
              onCloseOtherTabs(tab.id);
            }}
          >
            Close Other Tabs
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export function TabBar() {
  const tabViewRef = useRef(new Map<string, TabBarTab>());
  const tabs = useRequestStore(useShallow((state) => state.tabs.map((tab) => {
    const cached = tabViewRef.current.get(tab.id);
    if (
      cached
      && cached.name === tab.name
      && cached.isDirty === tab.isDirty
      && cached.method === tab.method
      && cached.tabType === tab.tabType
    ) {
      return cached;
    }

    const nextTab: TabBarTab = {
      id: tab.id,
      name: tab.name,
      isDirty: tab.isDirty,
      method: tab.method,
      tabType: tab.tabType,
    };
    tabViewRef.current.set(tab.id, nextTab);
    return nextTab;
  })));
  const activeTabId = useRequestStore((state) => state.activeTabId);
  const createTab = useRequestStore((state) => state.createTab);
  const duplicateTab = useRequestStore((state) => state.duplicateTab);
  const closeTab = useRequestStore((state) => state.closeTab);
  const closeOtherTabs = useRequestStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useRequestStore((state) => state.closeTabsToRight);
  const setActiveTab = useRequestStore((state) => state.setActiveTab);
  const saveActiveTab = useRequestStore((state) => state.saveActiveTab);
  const saveActiveTabAs = useRequestStore((state) => state.saveActiveTabAs);
  const tabLimitNotice = useRequestStore((state) => state.tabLimitNotice);
  const clearTabLimitNotice = useRequestStore((state) => state.clearTabLimitNotice);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const handleActivateTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, [setActiveTab]);

  const handleCloseTab = useCallback((event: MouseEvent | null, tabId: string) => {
    event?.stopPropagation();
    void closeTab(tabId);
  }, [closeTab]);

  const handleMiddleMouseCloseTab = useCallback((event: MouseEvent, tabId: string) => {
    if (event.button === 1) {
      event.preventDefault();
      void closeTab(tabId);
    }
  }, [closeTab]);

  const handleDuplicateTab = useCallback((tabId: string) => {
    duplicateTab(tabId);
  }, [duplicateTab]);

  const handleSaveTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
    void saveActiveTab();
  }, [saveActiveTab, setActiveTab]);

  const handleSaveTabAs = useCallback((tabId: string) => {
    setActiveTab(tabId);
    void saveActiveTabAs();
  }, [saveActiveTabAs, setActiveTab]);

  const handleCloseTabsToRight = useCallback((tabId: string) => {
    void closeTabsToRight(tabId);
  }, [closeTabsToRight]);

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    void closeOtherTabs(tabId);
  }, [closeOtherTabs]);

  const handleSetTabButtonRef = useCallback((tabId: string, element: HTMLButtonElement | null) => {
    if (element) {
      tabButtonRefs.current.set(tabId, element);
      return;
    }

    tabButtonRefs.current.delete(tabId);
  }, []);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }

    tabButtonRefs.current
      .get(activeTabId)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      tabButtonRefs.current.clear();
    };
  }, []);

  return (
    <div className="shrink-0 border-b border-border bg-background/95">
      <div className="flex h-10 items-center pl-2">
        <div className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab, tabIndex) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              hasTabsToRight={tabIndex >= 0 && tabIndex < tabs.length - 1}
              hasOtherTabs={tabs.length > 1}
              onActivate={handleActivateTab}
              onMiddleMouseClose={handleMiddleMouseCloseTab}
              onClose={handleCloseTab}
              onDuplicate={handleDuplicateTab}
              onSave={handleSaveTab}
              onSaveAs={handleSaveTabAs}
              onCloseTabsToRight={handleCloseTabsToRight}
              onCloseOtherTabs={handleCloseOtherTabs}
              setTabButtonRef={handleSetTabButtonRef}
            />
          ))}
        </div>

        <div className="pr-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="New tab"
            onClick={() => void createTab()}
          >
            <IconPlus />
          </Button>
        </div>
      </div>

      {tabLimitNotice ? (
        <div className="flex items-center justify-between gap-2 border-t border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-800 dark:text-amber-200">
          <span className="truncate">{tabLimitNotice}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss tab limit notice"
            onClick={() => {
              clearTabLimitNotice();
            }}
          >
            <IconX className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

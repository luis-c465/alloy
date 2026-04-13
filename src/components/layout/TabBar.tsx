import { useEffect, useRef } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";

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

export function TabBar() {
  const tabs = useRequestStore((state) => state.tabs);
  const activeTabId = useRequestStore((state) => state.activeTabId);
  const createTab = useRequestStore((state) => state.createTab);
  const duplicateTab = useRequestStore((state) => state.duplicateTab);
  const closeTab = useRequestStore((state) => state.closeTab);
  const closeOtherTabs = useRequestStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useRequestStore((state) => state.closeTabsToRight);
  const setActiveTab = useRequestStore((state) => state.setActiveTab);
  const saveActiveTab = useRequestStore((state) => state.saveActiveTab);
  const saveActiveTabAs = useRequestStore((state) => state.saveActiveTabAs);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());

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
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-background/95 pl-2">
      <div className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab, tabIndex) => {
          const isActive = tab.id === activeTabId;
          const method = tab.method.toUpperCase();
          const hasTabsToRight = tabIndex >= 0 && tabIndex < tabs.length - 1;
          const hasOtherTabs = tabs.length > 1;

          return (
            <ContextMenu key={tab.id}>
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
                      if (element) {
                        tabButtonRefs.current.set(tab.id, element);
                        return;
                      }

                      tabButtonRefs.current.delete(tab.id);
                    }}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    onMouseDown={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        void closeTab(tab.id);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 pl-2 text-xs"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        methodColorClasses[method] ?? methodColorClasses.GET,
                      )}
                    />

                    <span className="shrink-0 text-[10px] font-semibold tracking-wide">
                      {method}
                    </span>

                    <span className="truncate text-left">{tab.name || tab.url || "New Request"}</span>

                    {tab.isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                  </button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${tab.name || tab.url || "tab"}`}
                    className="my-auto size-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tab.id);
                    }}
                  >
                    <IconX className="size-3" />
                  </Button>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent className="w-52">
                <ContextMenuGroup>
                  <ContextMenuItem
                    onSelect={() => {
                      duplicateTab(tab.id);
                    }}
                  >
                    Duplicate Tab
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      setActiveTab(tab.id);
                      void saveActiveTab();
                    }}
                  >
                    Save
                    <ContextMenuShortcut>Mod+S</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      setActiveTab(tab.id);
                      void saveActiveTabAs();
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
                      void closeTab(tab.id);
                    }}
                  >
                    Close Tab
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!hasTabsToRight}
                    onSelect={() => {
                      void closeTabsToRight(tab.id);
                    }}
                  >
                    Close Tabs to the Right
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    disabled={!hasOtherTabs}
                    onSelect={() => {
                      void closeOtherTabs(tab.id);
                    }}
                  >
                    Close Other Tabs
                  </ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      <div className="pr-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New tab"
          onClick={() => createTab()}
        >
          <IconPlus />
        </Button>
      </div>
    </div>
  );
}

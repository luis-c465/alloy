import { IconPlus, IconX } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import { useRequestStore } from "~/stores/request-store";

const methodColorClasses: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  POST: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PUT: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  PATCH: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
  HEAD: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  OPTIONS: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export function TabBar() {
  const tabs = useRequestStore((state) => state.tabs);
  const activeTabId = useRequestStore((state) => state.activeTabId);
  const createTab = useRequestStore((state) => state.createTab);
  const closeTab = useRequestStore((state) => state.closeTab);
  const setActiveTab = useRequestStore((state) => state.setActiveTab);

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-background/95 pl-2">
      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const method = tab.method.toUpperCase();

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab.id);
                }
              }}
              className={`group flex h-full max-w-[150px] min-w-[120px] items-center gap-2 border-b-2 px-2 text-xs transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`inline-flex shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${methodColorClasses[method] ?? methodColorClasses.GET}`}
              >
                {method}
              </span>

              <span className="truncate text-left">{tab.name || tab.url || "New Request"}</span>

              {tab.isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}

              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded opacity-60 transition-opacity group-hover:opacity-100">
                <IconX
                  className="size-3"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                />
              </span>
            </button>
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

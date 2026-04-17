import { useEffect, useMemo, useState } from "react";
import {
  getHotkeyManager,
  useHotkeyRegistrations,
} from "@tanstack/react-hotkeys";
import { IconFileText, IconLayoutSidebar, IconMoon, IconSun, IconTerminal2 } from "@tabler/icons-react";
import type { FileEntry, HistoryEntry, HistoryFilter, HistoryListEntry } from "~/bindings";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/ui/command";
import {
  getHistoryEntry,
  listHistory,
  readHttpFile,
  setActiveEnvironment as setActiveEnvironmentApi,
} from "~/lib/api";
import { CATEGORY_ORDER, formatForDisplay, type ShortcutCategory } from "~/lib/shortcuts";
import { useRequestStore, type BodyType, type KeyValue, type Tab } from "~/stores/request-store";
import { type ThemeMode, useThemeStore } from "~/stores/theme-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type ShortcutPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSidebar: () => void;
  onOpenImportDialog: () => void;
  onOpenExportDialog: () => void;
  onOpenPostmanImportDialog: () => void;
};

const HISTORY_LIMIT = 8;
const RECENT_FILES_LIMIT = 8;

const toKeyValueList = (raw: string | null): KeyValue[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is { key: string; value: string; enabled?: boolean } =>
          typeof item === "object"
          && item !== null
          && "key" in item
          && "value" in item
          && typeof item.key === "string"
          && typeof item.value === "string",
      )
      .map((item) => ({
        key: item.key,
        value: item.value,
        enabled: item.enabled ?? true,
        id: crypto.randomUUID(),
      }));
  } catch {
    return [];
  }
};

const parseQueryParams = (url: string): KeyValue[] => {
  if (!url.trim()) {
    return [];
  }

  try {
    const parsedUrl = new URL(url);
    const params: KeyValue[] = [];

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      params.push({
        key,
        value,
        enabled: true,
        id: crypto.randomUUID(),
      });
    }

    return params;
  } catch {
    return [];
  }
};

const parseFormBody = (body: string): KeyValue[] => {
  const params = new URLSearchParams(body);
  const entries: KeyValue[] = [];

  for (const [key, value] of params.entries()) {
    entries.push({
      key,
      value,
      enabled: true,
      id: crypto.randomUUID(),
    });
  }

  return entries;
};

const inferBodyType = (headers: KeyValue[], body: string | null): BodyType => {
  if (!body?.trim()) {
    return "none";
  }

  const contentType =
    headers.find((header) => header.key.toLowerCase() === "content-type")?.value.toLowerCase()
    ?? "";

  if (contentType.includes("json")) {
    return "json";
  }

  if (contentType.includes("x-www-form-urlencoded")) {
    return "form-urlencoded";
  }

  const trimmedBody = body.trim();
  if (trimmedBody.startsWith("{") || trimmedBody.startsWith("[")) {
    try {
      JSON.parse(trimmedBody);
      return "json";
    } catch {
      return "raw";
    }
  }

  return "raw";
};

const toResponse = (entry: HistoryEntry): Tab["response"] => {
  if (entry.status === null) {
    return null;
  }

  return {
    status: entry.status,
    status_text: entry.status_text ?? "",
    headers: toKeyValueList(entry.response_headers).map(({ key, value, enabled }) => ({
      key,
      value,
      enabled,
    })),
    body: entry.response_body ?? "",
    is_binary: false,
    body_base64: null,
    content_type:
      toKeyValueList(entry.response_headers).find(
        (header) => header.key.toLowerCase() === "content-type",
      )?.value ?? "",
    size_bytes: entry.size_bytes ?? 0,
    time_ms: entry.time_ms ?? 0,
    is_truncated: false,
  };
};

const getTabName = (entry: HistoryEntry): string => {
  try {
    const parsed = new URL(entry.url);
    return `${entry.method.toUpperCase()} ${parsed.pathname || "/"}`;
  } catch {
    return `${entry.method.toUpperCase()} Request`;
  }
};

const mapHistoryEntryToTab = (entry: HistoryEntry): Partial<Tab> => {
  const headers = toKeyValueList(entry.request_headers);
  const bodyType = inferBodyType(headers, entry.request_body);

  return {
    tabType: "request",
    name: getTabName(entry),
    filePath: null,
    folderPath: null,
    isDirty: false,
    method: entry.method || "GET",
    url: entry.url,
    headers,
    queryParams: parseQueryParams(entry.url),
    bodyType,
    bodyContent: entry.request_body ?? "",
    bodyFormData:
      bodyType === "form-urlencoded"
        ? parseFormBody(entry.request_body ?? "")
        : [{ key: "", value: "", enabled: true, id: crypto.randomUUID() }],
    rawContentType:
      headers.find((header) => header.key.toLowerCase() === "content-type")?.value
      || (bodyType === "json" ? "application/json" : "text/plain"),
    authType: "inherit",
    authBearer: "",
    authBasicUsername: "",
    authBasicPassword: "",
    response: toResponse(entry),
    isLoading: false,
    error: null,
    activeRequestTab: "params",
    activeResponseTab: "body",
    activeFolderTab: "headers",
    folderHeaders: [{ key: "", value: "", enabled: true, id: crypto.randomUUID() }],
    folderVariables: [{ key: "", value: "", enabled: true, id: crypto.randomUUID() }],
    folderAuthType: "none",
    folderAuthBearer: "",
    folderAuthBasicUsername: "",
    folderAuthBasicPassword: "",
  };
};

const collectHttpFiles = (entries: FileEntry[]): string[] => {
  const files: string[] = [];

  const walk = (items: FileEntry[]) => {
    for (const item of items) {
      if (item.is_dir && item.children) {
        walk(item.children);
        continue;
      }

      if (!item.is_dir && item.path.toLowerCase().endsWith(".http")) {
        files.push(item.path);
      }
    }
  };

  walk(entries);
  return files;
};

const getRelativePath = (workspacePath: string | null, path: string): string => {
  if (!workspacePath) {
    return path;
  }

  if (path.startsWith(`${workspacePath}/`) || path.startsWith(`${workspacePath}\\`)) {
    return path.slice(workspacePath.length + 1);
  }

  return path;
};

const CYCLE_THEMES: ThemeMode[] = ["system", "light", "dark"];

const getNextTheme = (theme: ThemeMode): ThemeMode => {
  const index = CYCLE_THEMES.indexOf(theme);
  return CYCLE_THEMES[(index + 1) % CYCLE_THEMES.length] ?? "system";
};

export function ShortcutPalette({
  open,
  onOpenChange,
  onToggleSidebar,
  onOpenImportDialog,
  onOpenExportDialog,
  onOpenPostmanImportDialog,
}: ShortcutPaletteProps) {
  const { hotkeys } = useHotkeyRegistrations();
  const hotkeyManager = getHotkeyManager();
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const setActiveEnvironment = useWorkspaceStore((state) => state.setActiveEnvironment);
  const createTab = useRequestStore((state) => state.createTab);
  const saveActiveTab = useRequestStore((state) => state.saveActiveTab);
  const saveActiveTabAs = useRequestStore((state) => state.saveActiveTabAs);
  const sendRequest = useRequestStore((state) => state.sendRequest);
  const duplicateTab = useRequestStore((state) => state.duplicateTab);
  const closeTab = useRequestStore((state) => state.closeTab);
  const activeTabId = useRequestStore((state) => state.activeTabId);
  const tabs = useRequestStore((state) => state.tabs);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [historyEntries, setHistoryEntries] = useState<HistoryListEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const filter: HistoryFilter = {
      query: null,
      method: null,
      status_min: null,
      status_max: null,
      limit: HISTORY_LIMIT,
    };

    const run = async () => {
      try {
        const entries = await listHistory(filter);
        if (!cancelled) {
          setHistoryEntries(entries);
          setHistoryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryEntries([]);
          setHistoryError(error instanceof Error ? error.message : "Failed to load history");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const shortcutsByCategory = hotkeys.reduce<
    Map<ShortcutCategory, Array<(typeof hotkeys)[number]>>
  >((groups, shortcut) => {
    const category = shortcut.options.meta?.category;
    if (!category) {
      return groups;
    }

    const categoryShortcuts = groups.get(category) ?? [];
    categoryShortcuts.push(shortcut);
    groups.set(category, categoryShortcuts);
    return groups;
  }, new Map());

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );

  const hotkeyLabelByName = useMemo(() => {
    const map = new Map<string, string>();
    hotkeys.forEach((shortcut) => {
      const name = shortcut.options.meta?.name;
      if (name) {
        map.set(name, formatForDisplay(shortcut.hotkey));
      }
    });
    return map;
  }, [hotkeys]);

  const recentFiles = useMemo(() => {
    const recentFromTabs = tabs
      .filter((tab) => tab.filePath)
      .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt)
      .map((tab) => tab.filePath as string);
    const workspaceFiles = collectHttpFiles(fileTree);
    const unique = Array.from(new Set([...recentFromTabs, ...workspaceFiles]));
    return unique.slice(0, RECENT_FILES_LIMIT);
  }, [fileTree, tabs]);

  const runCommand = (callback: () => unknown | Promise<unknown>) => {
    onOpenChange(false);
    queueMicrotask(() => {
      void callback();
    });
  };

  const handleOpenHttpFile = async (path: string) => {
    const parsed = await readHttpFile(path);
    parsed.requests.forEach((request, index) => {
      void useRequestStore.getState().openRequestInTab(request, path, index);
    });
  };

  const handleSwitchEnvironment = async (name: string | null) => {
    if (!workspacePath) {
      return;
    }

    const previous = activeEnvironment;
    setActiveEnvironment(name);

    try {
      await setActiveEnvironmentApi(workspacePath, name);
    } catch {
      setActiveEnvironment(previous);
    }
  };

  const handleOpenHistory = async (id: number) => {
    const entry = await getHistoryEntry(id);
    if (!entry) {
      return;
    }

    await createTab(mapHistoryEntryToTab(entry));
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search and run commands across Alloy."
      className="max-w-2xl"
    >
      <Command>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>

        <CommandGroup heading="Request Actions">
          <CommandItem
            onSelect={() => {
              runCommand(sendRequest);
            }}
            className="items-start"
            value="send request run active request"
          >
            <span className="font-medium text-foreground">Send Request</span>
            <CommandShortcut>{hotkeyLabelByName.get("Send Request") ?? ""}</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              runCommand(saveActiveTab);
            }}
            className="items-start"
            value="save tab save active request"
          >
            <span className="font-medium text-foreground">Save Tab</span>
            <CommandShortcut>{hotkeyLabelByName.get("Save Tab") ?? ""}</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              runCommand(saveActiveTabAs);
            }}
            className="items-start"
            value="save tab as save request as"
          >
            <span className="font-medium text-foreground">Save Tab As</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              runCommand(createTab);
            }}
            className="items-start"
            value="new tab create request tab"
          >
            <span className="font-medium text-foreground">New Tab</span>
            <CommandShortcut>{hotkeyLabelByName.get("New Tab") ?? ""}</CommandShortcut>
          </CommandItem>

          <CommandItem
            disabled={!activeTabId}
            onSelect={() => {
              if (!activeTabId) {
                return;
              }

              runCommand(async () => {
                duplicateTab(activeTabId);
              });
            }}
            className="items-start"
            value="duplicate tab clone active tab"
          >
            <span className="font-medium text-foreground">Duplicate Tab</span>
          </CommandItem>

          <CommandItem
            disabled={!activeTabId}
            onSelect={() => {
              if (!activeTabId) {
                return;
              }

              runCommand(async () => {
                await closeTab(activeTabId);
              });
            }}
            className="items-start"
            value="close tab close active tab"
          >
            <span className="font-medium text-foreground">Close Tab</span>
            <CommandShortcut>{hotkeyLabelByName.get("Close Tab") ?? ""}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Recent Files">
          {recentFiles.length === 0 ? (
            <CommandItem disabled value="no recent files">
              No .http files available
            </CommandItem>
          ) : recentFiles.map((path) => (
            <CommandItem
              key={path}
              onSelect={() => {
                runCommand(async () => {
                  await handleOpenHttpFile(path);
                });
              }}
              className="items-start"
              value={`open file ${getRelativePath(workspacePath, path)} ${path}`}
            >
              <IconFileText className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">
                  {getRelativePath(workspacePath, path)}
                </span>
                <span className="truncate text-muted-foreground">{path}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Environments">
          <CommandItem
            disabled={!workspacePath}
            onSelect={() => {
              runCommand(async () => {
                await handleSwitchEnvironment(null);
              });
            }}
            value="no environment disable environment"
          >
            <span className="font-medium">No Environment</span>
            {activeEnvironment === null ? <CommandShortcut>Current</CommandShortcut> : null}
          </CommandItem>
          {environments.map((environment) => (
            <CommandItem
              key={environment.name}
              disabled={!workspacePath}
              onSelect={() => {
                runCommand(async () => {
                  await handleSwitchEnvironment(environment.name);
                });
              }}
              value={`switch environment ${environment.name}`}
            >
              <span className="font-medium">{environment.name}</span>
              {activeEnvironment === environment.name ? <CommandShortcut>Current</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="History Entries">
          {historyError ? (
            <CommandItem disabled value="history error">
              {historyError}
            </CommandItem>
          ) : historyEntries.length === 0 ? (
            <CommandItem disabled value="no history entries">
              No history entries yet
            </CommandItem>
          ) : historyEntries.map((entry) => (
            <CommandItem
              key={entry.id}
              onSelect={() => {
                runCommand(async () => {
                  await handleOpenHistory(entry.id);
                });
              }}
              className="items-start"
              value={`history ${entry.method} ${entry.url} ${entry.status ?? ""}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">
                  {entry.method.toUpperCase()} {entry.url}
                </span>
                <span className="text-muted-foreground">
                  {entry.status === null ? "No response" : `Status ${entry.status}`}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Import / Export">
          <CommandItem
            onSelect={() => {
              runCommand(async () => {
                onOpenImportDialog();
              });
            }}
            value="import curl"
          >
            <IconTerminal2 />
            <span className="font-medium">Import cURL</span>
          </CommandItem>
          <CommandItem
            disabled={!activeTab}
            onSelect={() => {
              runCommand(async () => {
                onOpenExportDialog();
              });
            }}
            value="export curl"
          >
            <IconTerminal2 />
            <span className="font-medium">Export as cURL</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              runCommand(async () => {
                onOpenPostmanImportDialog();
              });
            }}
            value="import postman collection"
          >
            <IconTerminal2 />
            <span className="font-medium">Import Postman Collection</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Theme / UI">
          <CommandItem
            onSelect={() => {
              runCommand(async () => {
                setTheme(getNextTheme(theme));
              });
            }}
            value="toggle theme light dark system"
          >
            {theme === "dark" ? <IconMoon /> : <IconSun />}
            <span className="font-medium">Cycle Theme</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              runCommand(async () => {
                onToggleSidebar();
              });
            }}
            value="toggle sidebar"
          >
            <IconLayoutSidebar />
            <span className="font-medium">Toggle Sidebar</span>
          </CommandItem>
        </CommandGroup>

          <CommandGroup heading="Keyboard Shortcuts">
            {CATEGORY_ORDER.map((category) => {
              const categoryShortcuts = shortcutsByCategory.get(category) ?? [];
              if (categoryShortcuts.length === 0) {
                return null;
              }

              return categoryShortcuts.map((shortcut) => (
                <CommandItem
                  key={shortcut.id}
                  value={`${category} ${shortcut.options.meta?.name ?? shortcut.hotkey} ${shortcut.options.meta?.description ?? ""} ${shortcut.hotkey}`}
                  onSelect={() => {
                    onOpenChange(false);
                    hotkeyManager.triggerRegistration(shortcut.id);
                  }}
                  className="items-start"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-foreground">
                      {shortcut.options.meta?.name ?? shortcut.hotkey}
                    </span>
                    <span className="text-muted-foreground">
                      {shortcut.options.meta?.description}
                    </span>
                  </div>
                  <CommandShortcut>
                    {formatForDisplay(shortcut.hotkey)}
                  </CommandShortcut>
                </CommandItem>
              ));
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

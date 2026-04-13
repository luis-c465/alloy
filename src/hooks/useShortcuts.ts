import { useCallback, useEffect, useMemo, useState } from "react";

import { setActiveEnvironment as setActiveEnvironmentApi } from "~/lib/api";
import {
  type Shortcut,
  shortcutRegistry,
  isMacPlatform,
} from "~/lib/shortcuts";
import { useRequestStore } from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type UseShortcutsOptions = {
  isPaletteOpen: boolean;
  onOpenPalette: () => void;
  onClosePalette: () => void;
};

type UseShortcutsResult = {
  shortcuts: Shortcut[];
  registerShortcut: (shortcut: Shortcut) => () => void;
  unregisterShortcut: (id: string) => void;
};

const focusUrlBar = (): boolean => {
  const urlInput = document.querySelector<HTMLInputElement>(
    'input[placeholder="Enter request URL..."]',
  );

  if (!urlInput) {
    return false;
  }

  urlInput.focus();
  urlInput.select();
  return true;
};

const saveActiveTab = (): void => {
  const requestStore = useRequestStore.getState();
  const activeTab = requestStore.tabs.find((tab) => tab.id === requestStore.activeTabId);

  if (activeTab?.filePath) {
    void requestStore.saveActiveTab();
    return;
  }

  void requestStore.saveActiveTabAs();
};

const cycleEnvironment = async (): Promise<boolean> => {
  const workspaceStore = useWorkspaceStore.getState();
  const {
    activeEnvironment,
    environments,
    setActiveEnvironment,
    workspacePath,
  } = workspaceStore;

  if (!workspacePath || environments.length === 0) {
    return false;
  }

  const currentIndex = environments.findIndex((environment) => environment.name === activeEnvironment);
  const nextIndex = (currentIndex + 1 + environments.length) % environments.length;
  const nextEnvironment = environments[nextIndex]?.name ?? null;
  const previousEnvironment = activeEnvironment;

  setActiveEnvironment(nextEnvironment);

  try {
    await setActiveEnvironmentApi(workspacePath, nextEnvironment);
    return true;
  } catch {
    setActiveEnvironment(previousEnvironment);
    return false;
  }
};

const activateAdjacentTab = (direction: -1 | 1): boolean => {
  const requestStore = useRequestStore.getState();
  const { activeTabId, tabs } = requestStore;

  if (!activeTabId || tabs.length <= 1) {
    return false;
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (currentIndex < 0) {
    return false;
  }

  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  requestStore.setActiveTab(tabs[nextIndex]!.id);
  return true;
};

export function useShortcuts({
  isPaletteOpen,
  onOpenPalette,
  onClosePalette,
}: UseShortcutsOptions): UseShortcutsResult {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => shortcutRegistry.getAll());

  const registerShortcut = useCallback((shortcut: Shortcut) => {
    shortcutRegistry.register(shortcut);

    return () => {
      shortcutRegistry.unregister(shortcut.id);
    };
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    shortcutRegistry.unregister(id);
  }, []);

  useEffect(() => shortcutRegistry.subscribe(() => {
    setShortcuts(shortcutRegistry.getAll());
  }), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      shortcutRegistry.handle(event);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const primaryModifier = useMemo(() => (isMacPlatform() ? "Cmd" : "Ctrl"), []);

  const defaultShortcuts = useMemo<Shortcut[]>(() => ([
    {
      id: "send-request",
      label: "Send Request",
      description: "Send the active request",
      keys: [`${primaryModifier}+Enter`],
      category: "Request",
      action: () => {
        void useRequestStore.getState().sendRequest();
      },
    },
    {
      id: "save-tab",
      label: "Save Tab",
      description: "Save the active request tab",
      keys: [`${primaryModifier}+S`],
      category: "Edit",
      action: () => {
        saveActiveTab();
      },
    },
    {
      id: "new-tab",
      label: "New Tab",
      description: "Create a new request tab",
      keys: [`${primaryModifier}+N`],
      category: "Tabs",
      action: () => {
        useRequestStore.getState().createTab();
      },
    },
    {
      id: "close-tab",
      label: "Close Tab",
      description: "Close the active request tab",
      keys: [`${primaryModifier}+W`],
      category: "Tabs",
      action: () => {
        const { activeTabId, closeTab } = useRequestStore.getState();
        if (!activeTabId) {
          return false;
        }

        void closeTab(activeTabId);
        return true;
      },
    },
    {
      id: "next-tab",
      label: "Next Tab",
      description: "Switch to the next request tab",
      keys: ["Ctrl+Tab"],
      category: "Tabs",
      action: () => activateAdjacentTab(1),
    },
    {
      id: "previous-tab",
      label: "Previous Tab",
      description: "Switch to the previous request tab",
      keys: ["Ctrl+Shift+Tab"],
      category: "Tabs",
      action: () => activateAdjacentTab(-1),
    },
    {
      id: "open-shortcut-palette",
      label: "Open Shortcut Palette",
      description: "Show all available keyboard shortcuts",
      keys: [`${primaryModifier}+K`],
      category: "General",
      action: () => {
        onOpenPalette();
      },
    },
    {
      id: "focus-url-bar",
      label: "Focus URL Bar",
      description: "Focus the request URL input",
      keys: [`${primaryModifier}+L`],
      category: "Navigation",
      action: () => focusUrlBar(),
    },
    {
      id: "switch-environment",
      label: "Switch Environment",
      description: "Cycle to the next available environment",
      keys: [`${primaryModifier}+E`],
      category: "Navigation",
      action: () => {
        void cycleEnvironment();
      },
    },
    {
      id: "close-current-dialog",
      label: "Close Current Dialog",
      description: "Close the shortcut palette",
      keys: ["Escape"],
      category: "General",
      action: () => {
        if (!isPaletteOpen) {
          return false;
        }

        onClosePalette();
        return true;
      },
    },
  ]), [isPaletteOpen, onClosePalette, onOpenPalette, primaryModifier]);

  useEffect(() => {
    const unregisterCallbacks = defaultShortcuts.map(registerShortcut);

    return () => {
      for (const unregister of unregisterCallbacks) {
        unregister();
      }
    };
  }, [defaultShortcuts, registerShortcut]);

  return {
    shortcuts,
    registerShortcut,
    unregisterShortcut,
  };
}

import { useMemo } from "react";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import { setActiveEnvironment as setActiveEnvironmentApi } from "~/lib/api";
import type { ShortcutCategory } from "~/lib/shortcuts";
import { useRequestStore } from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type UseShortcutsOptions = {
  onOpenPalette: () => void;
  onClosePalette: () => void;
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

const createShortcut = (
  hotkey: UseHotkeyDefinition["hotkey"],
  callback: UseHotkeyDefinition["callback"],
  category: ShortcutCategory,
  name: string,
  description: string,
  enabled = true,
): UseHotkeyDefinition => ({
  hotkey,
  callback,
  options: {
    enabled,
    meta: {
      category,
      description,
      name,
    },
  },
});

export function useShortcuts({
  onOpenPalette,
  onClosePalette,
}: UseShortcutsOptions): void {
  const defaultShortcuts = useMemo<UseHotkeyDefinition[]>(() => ([
    createShortcut(
      "Mod+Enter",
      () => {
        void useRequestStore.getState().sendRequest();
      },
      "Request",
      "Send Request",
      "Send the active request",
    ),
    createShortcut(
      "Mod+S",
      () => {
        saveActiveTab();
      },
      "Edit",
      "Save Tab",
      "Save the active request tab",
    ),
      createShortcut(
        "Mod+N",
        () => {
          void useRequestStore.getState().createTab();
        },
        "Tabs",
        "New Tab",
        "Create a new request tab",
    ),
    createShortcut(
      "Mod+W",
      () => {
        const { activeTabId, closeTab } = useRequestStore.getState();
        if (!activeTabId) {
          return;
        }

        void closeTab(activeTabId);
      },
      "Tabs",
      "Close Tab",
      "Close the active request tab",
    ),
    createShortcut(
      "Control+Tab",
      () => {
        activateAdjacentTab(1);
      },
      "Tabs",
      "Next Tab",
      "Switch to the next request tab",
    ),
    createShortcut(
      "Control+Shift+Tab",
      () => {
        activateAdjacentTab(-1);
      },
      "Tabs",
      "Previous Tab",
      "Switch to the previous request tab",
    ),
    createShortcut(
      "Mod+K",
      () => {
        onOpenPalette();
      },
      "General",
      "Open Shortcut Palette",
      "Show all available keyboard shortcuts",
    ),
    createShortcut(
      "Mod+L",
      () => {
        focusUrlBar();
      },
      "Navigation",
      "Focus URL Bar",
      "Focus the request URL input",
    ),
    createShortcut(
      "Mod+E",
      () => {
        void cycleEnvironment();
      },
      "Navigation",
      "Switch Environment",
      "Cycle to the next available environment",
    ),
    createShortcut(
      "Escape",
      () => {
        onClosePalette();
      },
      "General",
      "Close Current Dialog",
      "Close the shortcut palette",
    ),
  ]), [onClosePalette, onOpenPalette]);

  useHotkeys(defaultShortcuts);
}

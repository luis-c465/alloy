import { useRequestStore } from "~/stores/request-store";
import type { Tab } from "~/stores/request-store";

export function useActiveTab(): Tab | null {
  return useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id;
    if (!activeTabId) {
      return null;
    }

    return state.tabs.find((tab) => tab.id === activeTabId) ?? null;
  });
}

export function useActiveTabField<K extends keyof Tab>(
  field: K,
  fallback: Tab[K],
): Tab[K] {
  return useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id;
    if (!activeTabId) {
      return fallback;
    }

    const activeTab = state.tabs.find((tab) => tab.id === activeTabId);
    return activeTab?.[field] ?? fallback;
  });
}

import type { Tab } from "~/stores/request-store";

type RequestState = {
  tabs: Tab[];
  activeTabId: string | null;
};

export const selectActiveTab = (state: RequestState): Tab | null => {
  const activeTabId = state.activeTabId ?? state.tabs[0]?.id;
  if (!activeTabId) {
    return null;
  }

  return state.tabs.find((tab) => tab.id === activeTabId) ?? null;
};

export const createSelectActiveTabField = <K extends keyof Tab>(
  field: K,
  fallback: Tab[K],
) => (state: RequestState): Tab[K] => {
  const activeTab = selectActiveTab(state);
  return activeTab?.[field] ?? fallback;
};

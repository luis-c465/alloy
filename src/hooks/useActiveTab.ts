import { useMemo, useRef } from "react";
import { useRequestStore } from "~/stores/request-store";
import type { Tab } from "~/stores/request-store";
import { selectActiveTab } from "~/stores/request-selectors";

export function useActiveTab(): Tab | null {
  return useRequestStore(selectActiveTab);
}

export function useActiveTabField<K extends keyof Tab>(
  field: K,
  fallback: Tab[K],
): Tab[K] {
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const selector = useMemo(() => (state: { tabs: Tab[]; activeTabId: string | null }) => {
    const activeTab = selectActiveTab(state);
    return activeTab?.[field] ?? fallbackRef.current;
  }, [field]);
  return useRequestStore(selector);
}

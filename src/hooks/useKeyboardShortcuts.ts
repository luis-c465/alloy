import { useEffect } from "react";

import { useRequestStore } from "~/stores/request-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isPrimaryModifier = event.ctrlKey || event.metaKey;
      if (!isPrimaryModifier || event.altKey) {
        return;
      }

      const requestStore = useRequestStore.getState();
      const { activeTabId, tabs } = requestStore;

      switch (event.key) {
        case "s":
        case "S":
          event.preventDefault();
          if (tabs.find((tab) => tab.id === activeTabId)?.filePath) {
            void requestStore.saveActiveTab();
          } else {
            void requestStore.saveActiveTabAs();
          }
          return;
        case "w":
        case "W":
          event.preventDefault();
          if (activeTabId) {
            void requestStore.closeTab(activeTabId);
          }
          return;
        case "n":
        case "N":
        case "t":
        case "T":
          event.preventDefault();
          requestStore.createTab();
          return;
        case "Enter":
          event.preventDefault();
          void requestStore.sendRequest();
          return;
        case "Tab": {
          event.preventDefault();
          if (tabs.length <= 1 || !activeTabId) {
            return;
          }

          const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
          if (currentIndex < 0) {
            return;
          }

          const direction = event.shiftKey ? -1 : 1;
          const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
          requestStore.setActiveTab(tabs[nextIndex]!.id);
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

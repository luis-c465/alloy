export type ShortcutCategory = "Request" | "Tabs" | "Navigation" | "Edit" | "General";

export const CATEGORY_ORDER: ShortcutCategory[] = [
  "Request",
  "Tabs",
  "Navigation",
  "Edit",
  "General",
];

declare module "@tanstack/hotkeys" {
  interface HotkeyMeta {
    category?: ShortcutCategory;
  }
}

export { formatForDisplay } from "@tanstack/react-hotkeys";

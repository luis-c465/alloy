export type ShortcutCategory = "Request" | "Tabs" | "Navigation" | "Edit" | "General";

export type Shortcut = {
  id: string;
  label: string;
  description: string;
  keys: string[];
  action: () => boolean | void;
  category: ShortcutCategory;
};

type ShortcutListener = () => void;

const CATEGORY_ORDER: ShortcutCategory[] = [
  "Request",
  "Tabs",
  "Navigation",
  "Edit",
  "General",
];

const MODIFIER_ALIASES: Record<string, "ctrl" | "meta" | "alt" | "shift"> = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "meta",
  option: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
};

const MAC_SYMBOLS: Record<string, string> = {
  alt: "⌥",
  cmd: "⌘",
  ctrl: "⌃",
  escape: "Esc",
  meta: "⌘",
  shift: "⇧",
};

export const isMacPlatform = (): boolean => navigator.platform.toUpperCase().includes("MAC");

const normalizeToken = (token: string): string => token.trim().toLowerCase();

const normalizeEventKey = (key: string): string => {
  const normalized = normalizeToken(key);
  return KEY_ALIASES[normalized] ?? normalized;
};

const matchesShortcut = (shortcutKey: string, event: KeyboardEvent): boolean => {
  const parts = shortcutKey
    .split("+")
    .map((part) => normalizeToken(part))
    .filter(Boolean);

  let requiredCtrl = false;
  let requiredMeta = false;
  let requiredAlt = false;
  let requiredShift = false;
  let requiredKey: string | null = null;

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part];
    if (modifier === "ctrl") {
      requiredCtrl = true;
      continue;
    }
    if (modifier === "meta") {
      requiredMeta = true;
      continue;
    }
    if (modifier === "alt") {
      requiredAlt = true;
      continue;
    }
    if (modifier === "shift") {
      requiredShift = true;
      continue;
    }

    requiredKey = KEY_ALIASES[part] ?? part;
  }

  if (
    event.ctrlKey !== requiredCtrl
    || event.metaKey !== requiredMeta
    || event.altKey !== requiredAlt
    || event.shiftKey !== requiredShift
  ) {
    return false;
  }

  if (!requiredKey) {
    return false;
  }

  return normalizeEventKey(event.key) === requiredKey;
};

const compareShortcuts = (left: Shortcut, right: Shortcut): number => {
  const categoryDelta = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }

  return left.label.localeCompare(right.label);
};

export const getShortcutDisplayLabel = (shortcutKey: string): string => {
  const isMac = isMacPlatform();
  const parts = shortcutKey.split("+").map((part) => part.trim()).filter(Boolean);

  if (isMac) {
    return parts.map((part) => {
      const token = normalizeToken(part);
      return MAC_SYMBOLS[token] ?? part.toUpperCase();
    }).join("");
  }

  return parts.map((part) => {
    const token = normalizeToken(part);
    if (token === "cmd" || token === "meta") {
      return "Ctrl";
    }
    if (token === "escape") {
      return "Esc";
    }
    if (token === "alt") {
      return "Alt";
    }
    if (token === "shift") {
      return "Shift";
    }
    if (token === "ctrl") {
      return "Ctrl";
    }
    return part.length === 1 ? part.toUpperCase() : part;
  }).join("+");
};

export class ShortcutRegistry {
  private readonly shortcuts = new Map<string, Shortcut>();

  private readonly listeners = new Set<ShortcutListener>();

  register(shortcut: Shortcut): void {
    this.shortcuts.set(shortcut.id, shortcut);
    this.emit();
  }

  unregister(id: string): void {
    if (this.shortcuts.delete(id)) {
      this.emit();
    }
  }

  getAll(): Shortcut[] {
    return Array.from(this.shortcuts.values()).sort(compareShortcuts);
  }

  getByCategory(): Map<string, Shortcut[]> {
    const grouped = new Map<string, Shortcut[]>();

    for (const category of CATEGORY_ORDER) {
      grouped.set(category, []);
    }

    for (const shortcut of this.getAll()) {
      grouped.get(shortcut.category)?.push(shortcut);
    }

    for (const [category, shortcuts] of Array.from(grouped.entries())) {
      if (shortcuts.length === 0) {
        grouped.delete(category);
      }
    }

    return grouped;
  }

  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing) {
      return false;
    }

    const shortcut = this.getAll().find((candidate) => (
      candidate.keys.some((shortcutKey) => matchesShortcut(shortcutKey, event))
    ));

    if (!shortcut) {
      return false;
    }

    const handled = shortcut.action();
    if (handled === false) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  subscribe(listener: ShortcutListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const shortcutRegistry = new ShortcutRegistry();

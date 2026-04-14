import { useMemo } from "react";
import { useHotkeyRegistrations } from "@tanstack/react-hotkeys";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Switch } from "~/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { CATEGORY_ORDER, formatForDisplay, type ShortcutCategory } from "~/lib/shortcuts";
import { type ThemeMode, useThemeStore } from "~/stores/theme-store";
import { type DirtyTabEvictionMode, type NoClosableTabBehavior, useRequestStore } from "~/stores/request-store";

const TAB_LIMIT_MIN = 1;
const TAB_LIMIT_MAX = 100;

const isDirtyTabEvictionMode = (value: string): value is DirtyTabEvictionMode => (
  value === "protect" || value === "prompt"
);

const isNoClosableTabBehavior = (value: string): value is NoClosableTabBehavior => (
  value === "block" || value === "skip" || value === "prompt"
);

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const APP_VERSION = "0.1.0";

const getThemeLabel = (theme: ThemeMode): string => (
  theme === "system"
    ? "System"
    : theme === "light"
      ? "Light"
      : "Dark"
);

const isThemeMode = (value: string): value is ThemeMode => (
  value === "system" || value === "light" || value === "dark"
);

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const { hotkeys } = useHotkeyRegistrations();
  const tabLimitSettings = useRequestStore((state) => state.tabLimitSettings);
  const setTabLimitSettings = useRequestStore((state) => state.setTabLimitSettings);

  const shortcutsByCategory = useMemo(
    () => hotkeys.reduce<Map<ShortcutCategory, Array<(typeof hotkeys)[number]>>>(
      (groups, shortcut) => {
        const category = shortcut.options.meta?.category;
        if (!category) {
          return groups;
        }

        const categoryShortcuts = groups.get(category) ?? [];
        categoryShortcuts.push(shortcut);
        groups.set(category, categoryShortcuts);
        return groups;
      },
      new Map(),
    ),
    [hotkeys],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex min-h-[75vh] max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure appearance, review keyboard shortcuts, and view app information.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <TabsList variant="line" className="w-full justify-start border-b border-border p-0">
            <TabsTrigger value="appearance" className="rounded-none px-3">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="tabs" className="rounded-none px-3">
              Tabs
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="rounded-none px-3">
              Keyboard
            </TabsTrigger>
            <TabsTrigger value="about" className="rounded-none px-3">
              About
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tabs" className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium">Tab limit</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Control how many request tabs may stay open at once.
              </p>

              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <label htmlFor="tab-limit-enabled" className="text-xs font-medium text-foreground">
                    Enable limit
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Automatically apply LRU-style eviction when this limit is reached.
                  </p>
                </div>

                <Switch
                  id="tab-limit-enabled"
                  checked={tabLimitSettings.enabled}
                  onCheckedChange={(checked) => {
                    setTabLimitSettings({ enabled: checked });
                  }}
                />
              </div>

              <div className="mt-4 space-y-3">
                {tabLimitSettings.enabled ? (
                  <div>
                    <label htmlFor="tab-limit-count" className="text-xs font-medium text-foreground">
                      Max open tabs
                    </label>
                    <Input
                      id="tab-limit-count"
                      type="number"
                      min={TAB_LIMIT_MIN}
                      max={TAB_LIMIT_MAX}
                      step={1}
                      value={tabLimitSettings.limit}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        if (!Number.isInteger(nextValue)) {
                          return;
                        }

                        setTabLimitSettings({
                          limit: Math.min(TAB_LIMIT_MAX, Math.max(TAB_LIMIT_MIN, nextValue)),
                        });
                      }}
                      className="mt-1 w-28"
                    />
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-medium text-foreground">Dirty tabs</p>
                  <Select
                    value={tabLimitSettings.dirtyTabEvictionMode}
                    onValueChange={(value) => {
                      if (isDirtyTabEvictionMode(value)) {
                        setTabLimitSettings({ dirtyTabEvictionMode: value });
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="protect">Protect dirty tabs</SelectItem>
                      <SelectItem value="prompt">Prompt before closing dirty tabs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <p className="text-xs font-medium text-foreground">When no closable tab exists</p>
                  <Select
                    value={tabLimitSettings.whenNoClosableTab}
                    onValueChange={(value) => {
                      if (isNoClosableTabBehavior(value)) {
                        setTabLimitSettings({ whenNoClosableTab: value });
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">Block opening a new tab</SelectItem>
                      <SelectItem value="skip">Skip tab limit</SelectItem>
                      <SelectItem value="prompt">Prompt to close a tab</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium">Theme</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick how Alloy looks across the app.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Select
                  value={theme}
                  onValueChange={(value) => {
                    if (isThemeMode(value)) {
                      setTheme(value);
                    }
                  }}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>

                <Badge variant="outline">
                  Active: {theme === "system" ? `System (${getThemeLabel(resolvedTheme)})` : getThemeLabel(theme)}
                </Badge>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" className="flex min-h-0 flex-1 flex-col space-y-3">
            <p className="text-xs text-muted-foreground">
              Registered keyboard shortcuts available in the current app session.
            </p>

            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-muted/10">
              <div className="space-y-3 p-3">
                {CATEGORY_ORDER.map((category) => {
                  const categoryShortcuts = shortcutsByCategory.get(category) ?? [];
                  if (categoryShortcuts.length === 0) {
                    return null;
                  }

                  return (
                    <section key={category} className="space-y-1.5">
                      <h3 className="text-xs font-medium text-foreground">{category}</h3>

                      {categoryShortcuts.map((shortcut) => (
                        <div
                          key={shortcut.id}
                          className="flex items-center justify-between gap-2 rounded-sm border border-border/70 bg-background px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-foreground">
                              {shortcut.options.meta?.name ?? shortcut.hotkey}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {shortcut.options.meta?.description ?? "-"}
                            </div>
                          </div>
                          <Badge variant="outline" className="font-mono">
                            {formatForDisplay(shortcut.hotkey)}
                          </Badge>
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="about" className="space-y-3">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium">Alloy</div>
              <p className="mt-1 text-xs text-muted-foreground">
                API client desktop app built with Tauri, React, and TypeScript.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">Version {APP_VERSION}</Badge>
                <Badge variant="outline">React 19</Badge>
                <Badge variant="outline">Tauri 2</Badge>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

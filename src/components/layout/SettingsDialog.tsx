import { useMemo } from "react";
import { useHotkeyRegistrations } from "@tanstack/react-hotkeys";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure appearance, review keyboard shortcuts, and view app information.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="gap-3">
          <TabsList variant="line" className="w-full justify-start border-b border-border p-0">
            <TabsTrigger value="appearance" className="rounded-none px-3">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="rounded-none px-3">
              Keyboard
            </TabsTrigger>
            <TabsTrigger value="about" className="rounded-none px-3">
              About
            </TabsTrigger>
          </TabsList>

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

          <TabsContent value="shortcuts" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Registered keyboard shortcuts available in the current app session.
            </p>

            <ScrollArea className="h-72 rounded-md border border-border bg-muted/10">
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

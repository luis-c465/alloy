import {
  getHotkeyManager,
  useHotkeyRegistrations,
} from "@tanstack/react-hotkeys";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/ui/command";
import { CATEGORY_ORDER, formatForDisplay, type ShortcutCategory } from "~/lib/shortcuts";

type ShortcutPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutPalette({
  open,
  onOpenChange,
}: ShortcutPaletteProps) {
  const { hotkeys } = useHotkeyRegistrations();
  const hotkeyManager = getHotkeyManager();

  const shortcutsByCategory = hotkeys.reduce<
    Map<ShortcutCategory, Array<(typeof hotkeys)[number]>>
  >((groups, shortcut) => {
    const category = shortcut.options.meta?.category;
    if (!category) {
      return groups;
    }

    const categoryShortcuts = groups.get(category) ?? [];
    categoryShortcuts.push(shortcut);
    groups.set(category, categoryShortcuts);
    return groups;
  }, new Map());

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard Shortcuts"
      description="Search and run an available keyboard shortcut action."
      className="max-w-2xl"
    >
      <CommandInput placeholder="Search shortcuts..." />
      <CommandList>
        <CommandEmpty>No shortcuts found.</CommandEmpty>

        {CATEGORY_ORDER.map((category) => {
          const categoryShortcuts = shortcutsByCategory.get(category) ?? [];
          if (categoryShortcuts.length === 0) {
            return null;
          }

          return (
            <CommandGroup key={category} heading={category}>
              {categoryShortcuts.map((shortcut) => (
                <CommandItem
                  key={shortcut.id}
                  value={`${shortcut.options.meta?.name ?? shortcut.hotkey} ${shortcut.options.meta?.description ?? ""} ${shortcut.hotkey}`}
                  onSelect={() => {
                    onOpenChange(false);
                    hotkeyManager.triggerRegistration(shortcut.id);
                  }}
                  className="items-start"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-foreground">
                      {shortcut.options.meta?.name ?? shortcut.hotkey}
                    </span>
                    <span className="text-muted-foreground">
                      {shortcut.options.meta?.description}
                    </span>
                  </div>
                  <CommandShortcut>
                    {formatForDisplay(shortcut.hotkey)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

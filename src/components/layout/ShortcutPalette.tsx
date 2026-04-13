import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/ui/command";
import {
  type Shortcut,
  getShortcutDisplayLabel,
} from "~/lib/shortcuts";

type ShortcutPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: Shortcut[];
};

export function ShortcutPalette({
  open,
  onOpenChange,
  shortcuts,
}: ShortcutPaletteProps) {
  const shortcutsByCategory = shortcuts.reduce<Map<string, Shortcut[]>>((groups, shortcut) => {
    const categoryShortcuts = groups.get(shortcut.category) ?? [];
    categoryShortcuts.push(shortcut);
    groups.set(shortcut.category, categoryShortcuts);
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

        {Array.from(shortcutsByCategory.entries()).map(([category, categoryShortcuts]) => (
          <CommandGroup key={category} heading={category}>
            {categoryShortcuts.map((shortcut) => (
              <CommandItem
                key={shortcut.id}
                value={`${shortcut.label} ${shortcut.description} ${shortcut.keys.join(" ")}`}
                onSelect={() => {
                  onOpenChange(false);
                  shortcut.action();
                }}
                className="items-start"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium text-foreground">
                    {shortcut.label}
                  </span>
                  <span className="text-muted-foreground">
                    {shortcut.description}
                  </span>
                </div>
                <CommandShortcut>
                  {getShortcutDisplayLabel(shortcut.keys[0] ?? "")}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

import {
  IconDeviceDesktop,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  type ThemeMode,
  useThemeStore,
} from "~/stores/theme-store";

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

const getThemeLabel = (theme: ThemeMode): string => (
  theme === "system"
    ? "System"
    : theme === "light"
      ? "Light"
      : "Dark"
);

const getNextTheme = (theme: ThemeMode): ThemeMode => {
  const index = THEME_ORDER.indexOf(theme);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "system";
};

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const nextTheme = getNextTheme(theme);
  const tooltipLabel = theme === "system"
    ? `Theme: System (${getThemeLabel(resolvedTheme)})`
    : `Theme: ${getThemeLabel(theme)}`;

  const Icon = theme === "system"
    ? IconDeviceDesktop
    : theme === "dark"
      ? IconMoon
      : IconSun;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${tooltipLabel}. Switch to ${getThemeLabel(nextTheme)} mode`}
            onClick={() => setTheme(nextTheme)}
          >
            <Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={4}>
          {tooltipLabel} · Next: {getThemeLabel(nextTheme)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

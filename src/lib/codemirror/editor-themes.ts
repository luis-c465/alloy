import { type Extension } from "@codemirror/state";
import {
  abcdef,
  abyss,
  androidStudio,
  andromeda,
  basicDark,
  basicLight,
  catppuccinMocha,
  cobalt2,
  forest,
  githubDark,
  githubLight,
  gruvboxDark,
  gruvboxLight,
  highContrastDark,
  highContrastLight,
  materialDark,
  materialLight,
  materialOcean,
  monokai,
  nord,
  palenight,
  solarizedDark,
  solarizedLight,
  synthwave84,
  tokyoNightDay,
  tokyoNightStorm,
  volcano,
  vsCodeDark,
  vsCodeLight,
} from "@fsegurai/codemirror-theme-bundle";

export interface EditorThemeOption {
  label: string;
  extension: Extension;
}

export const EDITOR_THEMES: Record<string, EditorThemeOption> = {
  abcdef:            { label: "ABCDEF",               extension: abcdef },
  abyss:             { label: "Abyss",                extension: abyss },
  androidStudio:     { label: "Android Studio",       extension: androidStudio },
  andromeda:         { label: "Andromeda",             extension: andromeda },
  basicDark:         { label: "Basic Dark",            extension: basicDark },
  basicLight:        { label: "Basic Light",           extension: basicLight },
  catppuccinMocha:   { label: "Catppuccin Mocha",      extension: catppuccinMocha },
  cobalt2:           { label: "Cobalt2",               extension: cobalt2 },
  forest:            { label: "Forest",                extension: forest },
  githubDark:        { label: "GitHub Dark",           extension: githubDark },
  githubLight:       { label: "GitHub Light",          extension: githubLight },
  gruvboxDark:       { label: "Gruvbox Dark",          extension: gruvboxDark },
  gruvboxLight:      { label: "Gruvbox Light",         extension: gruvboxLight },
  highContrastDark:  { label: "High Contrast Dark",    extension: highContrastDark },
  highContrastLight: { label: "High Contrast Light",   extension: highContrastLight },
  materialDark:      { label: "Material Dark",         extension: materialDark },
  materialLight:     { label: "Material Light",        extension: materialLight },
  materialOcean:     { label: "Material Ocean",        extension: materialOcean },
  monokai:           { label: "Monokai",               extension: monokai },
  nord:              { label: "Nord",                  extension: nord },
  palenight:         { label: "Palenight",             extension: palenight },
  solarizedDark:     { label: "Solarized Dark",        extension: solarizedDark },
  solarizedLight:    { label: "Solarized Light",       extension: solarizedLight },
  synthwave84:       { label: "Synthwave 84",          extension: synthwave84 },
  tokyoNightDay:     { label: "Tokyo Night Day",       extension: tokyoNightDay },
  tokyoNightStorm:   { label: "Tokyo Night Storm",     extension: tokyoNightStorm },
  volcano:           { label: "Volcano",               extension: volcano },
  vsCodeDark:        { label: "VS Code Dark",          extension: vsCodeDark },
  vsCodeLight:       { label: "VS Code Light",         extension: vsCodeLight },
};

export const DEFAULT_EDITOR_THEME_DARK = "githubDark";
export const DEFAULT_EDITOR_THEME_LIGHT = "githubLight";

export function getEditorThemeExtension(key: string): Extension {
  return EDITOR_THEMES[key]?.extension ?? githubLight;
}

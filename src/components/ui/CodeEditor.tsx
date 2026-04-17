import CodeMirror, { type Extension } from "@uiw/react-codemirror";

import { cn } from "~/lib/utils";
import { getEditorThemeExtension } from "~/lib/codemirror/editor-themes";
import { useThemeStore } from "~/stores/theme-store";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  extensions?: Extension[];
  readOnly?: boolean;
  editable?: boolean;
  className?: string;
  minHeight?: string;
  autocompletion?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  extensions,
  readOnly,
  editable,
  className,
  minHeight,
  autocompletion = false,
}: CodeEditorProps) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const editorThemeLight = useThemeStore((state) => state.editorThemeLight);
  const editorThemeDark = useThemeStore((state) => state.editorThemeDark);

  const themeExtension = resolvedTheme === "dark"
    ? getEditorThemeExtension(editorThemeDark)
    : getEditorThemeExtension(editorThemeLight);

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <CodeMirror
        value={value}
        onChange={(nextValue) => {
          onChange?.(nextValue);
        }}
        extensions={[themeExtension, ...(extensions ?? [])]}
        editable={editable}
        readOnly={readOnly}
        height="100%"
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          autocompletion,
        }}
        theme="none"
      />
    </div>
  );
}

import { oneDark } from "@codemirror/theme-one-dark"
import { EditorView, keymap } from "@codemirror/view"
import CodeMirror, { type Extension } from "@uiw/react-codemirror"
import { useMemo } from "react"

import { useEnvironmentVariables } from "~/hooks/useEnvironmentVariables"
import { variableExtension } from "~/lib/codemirror/variable-extensions"
import { cn } from "~/lib/utils"
import { useThemeStore } from "~/stores/theme-store"

interface VariableInputProps {
  value: string
  onChange?: (value: string) => void
  onEnter?: () => void
  placeholder?: string
  className?: string
  readOnly?: boolean
}

export function VariableInput({
  value,
  onChange,
  onEnter,
  placeholder,
  className,
  readOnly,
}: VariableInputProps) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const variables = useEnvironmentVariables()

  const extensions = useMemo<Extension[]>(() => {
    return [
      variableExtension(variables),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          height: "100%",
        },
        ".cm-editor": {
          outline: "none",
        },
        ".cm-focused": {
          outline: "none",
        },
        ".cm-content": {
          padding: "0",
          caretColor: "var(--foreground)",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
        },
        ".cm-line": {
          padding: "0",
        },
        ".cm-scroller": {
          overflow: "hidden",
          lineHeight: "1.5",
        },
        ".cm-placeholder": {
          color: "var(--muted-foreground)",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--foreground)",
        },
      }),
      keymap.of([
        {
          key: "Enter",
          run: () => {
            onEnter?.()
            return true
          },
        },
        {
          key: "Tab",
          run: () => false,
        },
      ]),
    ]
  }, [variables, onEnter])

  return (
    <div
      className={cn(
        "variable-input-wrapper flex items-center h-7 w-full min-w-0 rounded-md border border-input/70 bg-transparent px-2 py-0.5 text-xs font-mono text-foreground transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
        readOnly ? "cursor-not-allowed opacity-50" : null,
        className
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        editable={readOnly ? false : true}
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          history: true,
          drawSelection: true,
          syntaxHighlighting: false,
          defaultKeymap: true,
          historyKeymap: true,
          searchKeymap: false,
          highlightSelectionMatches: false,
          autocompletion: false,
        }}
        theme={resolvedTheme === "dark" ? oneDark : "light"}
      />
    </div>
  )
}

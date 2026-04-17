import { javascript } from "@codemirror/lang-javascript";
import { type Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";
import { useThemeStore } from "~/stores/theme-store";
import { buildScriptExtensions } from "~/lib/codemirror/script-extensions";
import { getEditorThemeExtension } from "~/lib/codemirror/editor-themes";

type ScriptTab = "pre-request" | "post-response";

// Base JavaScript extensions used immediately while the TS worker is loading.
const baseExtensions: Extension[] = [javascript({ typescript: true })];

export function ScriptsEditor() {
  const preRequestScript = useActiveTabField("preRequestScript", "");
  const postResponseScript = useActiveTabField("postResponseScript", "");
  const setPreRequestScript = useRequestStore((state) => state.setPreRequestScript);
  const setPostResponseScript = useRequestStore((state) => state.setPostResponseScript);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const editorThemeLight = useThemeStore((state) => state.editorThemeLight);
  const editorThemeDark = useThemeStore((state) => state.editorThemeDark);

  const themeExtension = resolvedTheme === "dark"
    ? getEditorThemeExtension(editorThemeDark)
    : getEditorThemeExtension(editorThemeLight);

  const [activeScriptTab, setActiveScriptTab] = useState<ScriptTab>("pre-request");

  // Start with syntax highlighting only; TS extensions are added once the
  // worker has initialised (happens asynchronously in the background).
  const [preExtensions, setPreExtensions] = useState<Extension[]>(baseExtensions);
  const [postExtensions, setPostExtensions] = useState<Extension[]>(baseExtensions);

  useEffect(() => {
    // Kick off both workers in parallel. Each resolves independently.
    buildScriptExtensions("pre", "pre-request.ts").then((tsExts) => {
      setPreExtensions([javascript({ typescript: true }), ...tsExts]);
    });
    buildScriptExtensions("post", "post-response.ts").then((tsExts) => {
      setPostExtensions([javascript({ typescript: true }), ...tsExts]);
    });
  }, []);

  return (
    <div className="flex h-full min-h-[200px] flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {"// "}
        Use the <code className="font-mono">alloy</code> global. e.g.{" "}
        <code className="font-mono">alloy.environment.set("token", "abc")</code>
      </p>

      <Tabs
        value={activeScriptTab}
        onValueChange={(value) => setActiveScriptTab(value as ScriptTab)}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="pre-request">Pre-request</TabsTrigger>
          <TabsTrigger value="post-response">Post-response</TabsTrigger>
        </TabsList>

        <TabsContent
          value="pre-request"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <CodeMirror
            value={preRequestScript}
            onChange={setPreRequestScript}
            extensions={[themeExtension, ...preExtensions]}
            minHeight="200px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
            }}
            theme="none"
            className="h-full"
          />
        </TabsContent>

        <TabsContent
          value="post-response"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <CodeMirror
            value={postResponseScript}
            onChange={setPostResponseScript}
            extensions={[themeExtension, ...postExtensions]}
            minHeight="200px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
            }}
            theme="none"
            className="h-full"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";
import { useThemeStore } from "~/stores/theme-store";

type ScriptTab = "pre-request" | "post-response";

export function ScriptsEditor() {
  const preRequestScript = useActiveTabField("preRequestScript", "");
  const postResponseScript = useActiveTabField("postResponseScript", "");
  const setPreRequestScript = useRequestStore((state) => state.setPreRequestScript);
  const setPostResponseScript = useRequestStore((state) => state.setPostResponseScript);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [activeScriptTab, setActiveScriptTab] = useState<ScriptTab>("pre-request");

  const extensions = useMemo(() => [javascript()], []);

  return (
    <div className="flex h-full min-h-[200px] flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {"// "}
        Use the <code className="font-mono">alloy</code> global. e.g. <code className="font-mono">alloy.environment.set("token", "abc")</code>
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
            extensions={extensions}
            minHeight="200px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
            }}
            theme={resolvedTheme === "dark" ? oneDark : "light"}
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
            extensions={extensions}
            minHeight="200px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
            }}
            theme={resolvedTheme === "dark" ? oneDark : "light"}
            className="h-full"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

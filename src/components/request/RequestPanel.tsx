import { AuthEditor } from "~/components/request/AuthEditor";
import { BodyEditor } from "~/components/request/BodyEditor";
import { HeadersEditor } from "~/components/request/HeadersEditor";
import { MethodSelector } from "~/components/request/MethodSelector";
import { OptionsEditor } from "~/components/request/OptionsEditor";
import { ParamsEditor } from "~/components/request/ParamsEditor";
import { ResolvedUrlPreview } from "~/components/request/ResolvedUrlPreview";
import { SendButton } from "~/components/request/SendButton";
import { UrlBar } from "~/components/request/UrlBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

export function RequestPanel() {
  const activeRequestTab = useActiveTabField("activeRequestTab", "params");
  const authType = useActiveTabField("authType", "none");
  const skipSslVerification = useActiveTabField("skipSslVerification", false);
  const timeoutMs = useActiveTabField("timeoutMs", null);
  const setActiveRequestTab = useRequestStore(
    (state) => state.setActiveRequestTab,
  );
  const hasActiveOptions = skipSslVerification || timeoutMs !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <MethodSelector />
        <UrlBar />
        <SendButton />
      </div>

      <ResolvedUrlPreview />

      <div className="min-h-0 flex-1 border-t border-border p-3">
        <Tabs
          value={activeRequestTab}
          onValueChange={(tab) =>
            setActiveRequestTab(
              tab as "params" | "headers" | "body" | "auth" | "options",
            )
          }
          className="flex h-full min-h-0 flex-col gap-3"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="body">Body</TabsTrigger>
            <TabsTrigger value="auth">Auth</TabsTrigger>
            <TabsTrigger value="options">
              Options
              {hasActiveOptions ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="params" className="min-h-0 flex-1 overflow-auto">
            <ParamsEditor />
          </TabsContent>

          <TabsContent value="headers" className="min-h-0 flex-1 overflow-auto">
            <div className="flex h-full flex-col gap-3">
              {authType !== "none" ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Authorization header is managed by the Auth tab.
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-auto">
                <HeadersEditor />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="body" className="min-h-0 flex-1 overflow-auto">
            <BodyEditor />
          </TabsContent>

          <TabsContent value="auth" className="min-h-0 flex-1 overflow-auto">
            <AuthEditor />
          </TabsContent>

          <TabsContent value="options" className="min-h-0 flex-1 overflow-auto">
            <OptionsEditor />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

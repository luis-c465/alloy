import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { useWorkspaceStore } from "~/stores/workspace-store";
import {
  encodeBase64Utf8,
  getEnvironmentVariableMap,
  getAuthorizationHeaderValue,
  resolveTemplateString,
  useRequestStore,
  type AuthType,
} from "~/stores/request-store";

const AUTH_TYPE_OPTIONS: Array<{ value: AuthType; label: string }> = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
];

export function AuthEditor() {
  const activeTab = useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id;
    if (!activeTabId) {
      return null;
    }

    return state.tabs.find((tab) => tab.id === activeTabId) ?? null;
  });
  const setAuthType = useRequestStore((state) => state.setAuthType);
  const setAuthBearer = useRequestStore((state) => state.setAuthBearer);
  const setAuthBasicUsername = useRequestStore(
    (state) => state.setAuthBasicUsername,
  );
  const setAuthBasicPassword = useRequestStore(
    (state) => state.setAuthBasicPassword,
  );
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const activeEnvironmentVariables = useWorkspaceStore((state) => {
    const activeName = state.activeEnvironment;

    return state.environments.find((environment) => environment.name === activeName)
      ?.variables ?? [];
  });
  const [showPassword, setShowPassword] = useState(false);

  const authType = activeTab?.authType ?? "none";
  const authBearer = activeTab?.authBearer ?? "";
  const authBasicUsername = activeTab?.authBasicUsername ?? "";
  const authBasicPassword = activeTab?.authBasicPassword ?? "";
  const hasManualAuthorizationHeader =
    activeTab?.headers.some(
      (header) =>
        header.enabled && header.key.trim().toLowerCase() === "authorization",
    ) ?? false;

  const previewValue = useMemo(() => {
    const environmentVariables = getEnvironmentVariableMap(activeEnvironmentVariables);

    return getAuthorizationHeaderValue(
      authType,
      resolveTemplateString(authBearer, environmentVariables),
      resolveTemplateString(authBasicUsername, environmentVariables),
      resolveTemplateString(authBasicPassword, environmentVariables),
    );
  }, [
    activeEnvironmentVariables,
    authBasicPassword,
    authBasicUsername,
    authBearer,
    authType,
  ]);

  return (
    <div className="flex h-full min-h-[100px] flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {AUTH_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAuthType(option.value)}
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                authType === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {authType === "none" ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          This request does not use authentication.
        </div>
      ) : null}

      {authType === "bearer" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-bearer-token"
              className="text-xs font-medium text-foreground"
            >
              Token
            </label>
            <Input
              id="auth-bearer-token"
              value={authBearer}
              placeholder="Enter token..."
              onChange={(event) => setAuthBearer(event.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Supports <span className="font-mono">{"{{variable}}"}</span>
              {" "}templates and resolves them when sending the request.
            </p>
          </div>

          {!authBearer.trim() ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Bearer token is empty, so no Authorization header will be added.
            </div>
          ) : null}
        </div>
      ) : null}

      {authType === "basic" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-basic-username"
              className="text-xs font-medium text-foreground"
            >
              Username
            </label>
            <Input
              id="auth-basic-username"
              value={authBasicUsername}
              placeholder="Enter username..."
              onChange={(event) => setAuthBasicUsername(event.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-basic-password"
              className="text-xs font-medium text-foreground"
            >
              Password
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="auth-basic-password"
                type={showPassword ? "text" : "password"}
                value={authBasicPassword}
                placeholder="Enter password..."
                onChange={(event) => setAuthBasicPassword(event.target.value)}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Preview uses UTF-8-safe Base64 encoding (
              <span className="font-mono">
                {encodeBase64Utf8(`${authBasicUsername}:${authBasicPassword}`)}
              </span>
              ).
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">
            Authorization header preview
          </p>
          <p className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground break-all">
            {previewValue ?? "No Authorization header will be sent."}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          The Authorization header will be auto-added when sending the request.
        </p>

        {activeEnvironment ? (
          <p className="text-xs text-muted-foreground">
            Preview reflects variables from the active environment: {activeEnvironment}.
          </p>
        ) : null}

        {hasManualAuthorizationHeader && authType !== "none" ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            A manual Authorization header exists in the Headers tab and will be
            replaced by this auth preset when the request is sent.
          </div>
        ) : null}
      </div>
    </div>
  );
}

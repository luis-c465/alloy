import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { VariableInput } from "~/components/ui/VariableInput";
import { cn } from "~/lib/utils";
import type { KeyValue } from "~/bindings";
import { useWorkspaceStore } from "~/stores/workspace-store";
import {
  encodeBase64Utf8,
  getEnvironmentVariableMap,
  getAuthorizationHeaderValue,
  resolveTemplateString,
  useRequestStore,
  type AuthType,
  type FolderAuthType,
} from "~/stores/request-store";

type AuthEditorProps = {
  authScope?: "request" | "folder";
};

const REQUEST_AUTH_TYPE_OPTIONS: Array<{ value: AuthType; label: string }> = [
  { value: "inherit", label: "Inherit" },
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
];

const FOLDER_AUTH_TYPE_OPTIONS: Array<{ value: FolderAuthType; label: string }> = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
];

// Stable empty array fallback for useWorkspaceStore selectors. Returning an
// inline `?? []` literal inside a Zustand selector creates a new array reference
// on every call, which causes React's useSyncExternalStore to detect a spurious
// change and trigger an infinite re-render loop.
const EMPTY_ENV_VARIABLES: KeyValue[] = [];

export function AuthEditor({ authScope = "request" }: AuthEditorProps) {
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
  const setFolderAuthType = useRequestStore((state) => state.setFolderAuthType);
  const setFolderAuthBearer = useRequestStore((state) => state.setFolderAuthBearer);
  const setFolderAuthBasicUsername = useRequestStore((state) => state.setFolderAuthBasicUsername);
  const setFolderAuthBasicPassword = useRequestStore((state) => state.setFolderAuthBasicPassword);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const getFolderConfigChain = useWorkspaceStore((state) => state.getFolderConfigChain);
  const activeEnvironmentVariables = useWorkspaceStore((state) => {
    const activeName = state.activeEnvironment;

    return state.environments.find((environment) => environment.name === activeName)
      ?.variables ?? EMPTY_ENV_VARIABLES;
  });
  const [showPassword, setShowPassword] = useState(false);

  const authType = authScope === "folder"
    ? (activeTab?.folderAuthType ?? "none")
    : (activeTab?.authType ?? "inherit");
  const authBearer = authScope === "folder"
    ? (activeTab?.folderAuthBearer ?? "")
    : (activeTab?.authBearer ?? "");
  const authBasicUsername = authScope === "folder"
    ? (activeTab?.folderAuthBasicUsername ?? "")
    : (activeTab?.authBasicUsername ?? "");
  const authBasicPassword = authScope === "folder"
    ? (activeTab?.folderAuthBasicPassword ?? "")
    : (activeTab?.authBasicPassword ?? "");
  const hasManualAuthorizationHeader =
    activeTab?.headers.some(
      (header) =>
        header.enabled && header.key.trim().toLowerCase() === "authorization",
    ) ?? false;

  const inheritedFolderAuth = useMemo(() => {
    if (authScope !== "request" || !activeTab || activeTab.tabType !== "request") {
      return null;
    }

    const chain = getFolderConfigChain(activeTab.filePath);
    if (chain.length === 0) {
      return null;
    }

    // Walk from innermost folder outward, same logic as the backend, to find
    // the first folder that actually configures auth (auth_type != "none").
    const source = [...chain].reverse().find((entry) => entry.config.auth_type !== "none");
    return source ?? null;
  }, [activeTab, authScope, getFolderConfigChain]);

  const effectiveAuthType: AuthType | FolderAuthType =
    authScope === "request" && authType === "inherit"
      ? ((inheritedFolderAuth?.config.auth_type as FolderAuthType | undefined) ?? "none")
      : authType;

  const effectiveBearer =
    authScope === "request" && authType === "inherit"
      ? (inheritedFolderAuth?.config.auth_bearer ?? "")
      : authBearer;
  const effectiveUsername =
    authScope === "request" && authType === "inherit"
      ? (inheritedFolderAuth?.config.auth_basic_username ?? "")
      : authBasicUsername;
  const effectivePassword =
    authScope === "request" && authType === "inherit"
      ? (inheritedFolderAuth?.config.auth_basic_password ?? "")
      : authBasicPassword;

  const previewValue = useMemo(() => {
    const environmentVariables = getEnvironmentVariableMap(activeEnvironmentVariables);
    const requestVariables = getEnvironmentVariableMap(activeTab?.variables ?? []);
    const variables = new Map([...environmentVariables, ...requestVariables]);

    return getAuthorizationHeaderValue(
      effectiveAuthType,
      resolveTemplateString(effectiveBearer, variables),
      resolveTemplateString(effectiveUsername, variables),
      resolveTemplateString(effectivePassword, variables),
    );
  }, [
    activeTab?.variables,
    activeEnvironmentVariables,
    effectiveAuthType,
    effectiveBearer,
    effectivePassword,
    effectiveUsername,
  ]);

  const authOptions = authScope === "folder" ? FOLDER_AUTH_TYPE_OPTIONS : REQUEST_AUTH_TYPE_OPTIONS;

  const setAuthTypeForScope = (value: string) => {
    if (authScope === "folder") {
      setFolderAuthType(value as FolderAuthType);
      return;
    }

    setAuthType(value as AuthType);
  };

  const setAuthBearerForScope = (value: string) => {
    if (authScope === "folder") {
      setFolderAuthBearer(value);
      return;
    }

    setAuthBearer(value);
  };

  const setAuthUsernameForScope = (value: string) => {
    if (authScope === "folder") {
      setFolderAuthBasicUsername(value);
      return;
    }

    setAuthBasicUsername(value);
  };

  const setAuthPasswordForScope = (value: string) => {
    if (authScope === "folder") {
      setFolderAuthBasicPassword(value);
      return;
    }

    setAuthBasicPassword(value);
  };

  return (
    <div className="flex h-full min-h-[100px] flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {authOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAuthTypeForScope(option.value)}
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

      {authScope === "request" && authType === "inherit" ? (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {inheritedFolderAuth
            ? (() => {
                const type = inheritedFolderAuth.config.auth_type;
                const label = type === "bearer" ? "Bearer Token" : type === "basic" ? "Basic Auth" : type;
                const folderName = inheritedFolderAuth.folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? inheritedFolderAuth.folderPath;
                return `Inheriting ${label} from "${folderName}"`;
              })()
            : "No folder auth configured. Effective auth is None."}
        </div>
      ) : null}

      {effectiveAuthType === "none" ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          {authScope === "folder"
            ? "This folder does not apply authentication."
            : "This request does not use authentication."}
        </div>
      ) : null}

      {effectiveAuthType === "bearer" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-bearer-token"
              className="text-xs font-medium text-foreground"
            >
              Token
            </label>
            <VariableInput
              value={authBearer}
              placeholder="Enter token..."
              onChange={setAuthBearerForScope}
              singleLine
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              Supports <span className="font-mono">{"{{variable}}"}</span>
              {" "}templates and resolves them when sending the request.
            </p>
          </div>

          {!effectiveBearer.trim() ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Bearer token is empty, so no Authorization header will be added.
            </div>
          ) : null}
        </div>
      ) : null}

      {effectiveAuthType === "basic" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-basic-username"
              className="text-xs font-medium text-foreground"
            >
              Username
            </label>
            <VariableInput
              value={authBasicUsername}
              placeholder="Enter username..."
              onChange={setAuthUsernameForScope}
              singleLine
              className="h-9"
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
                onChange={(event) => setAuthPasswordForScope(event.target.value)}
                className="font-mono"
                disabled={authScope === "request" && authType === "inherit"}
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

        {authScope === "request" ? (
          <p className="text-xs text-muted-foreground">
            The Authorization header will be auto-added when sending the request.
          </p>
        ) : null}

        {activeEnvironment ? (
          <p className="text-xs text-muted-foreground">
            Preview reflects variables from the active environment ({activeEnvironment}) and request-level variables.
          </p>
        ) : null}

        {authScope === "request" && hasManualAuthorizationHeader && effectiveAuthType !== "none" ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            A manual Authorization header exists in the Headers tab and will be
            replaced by this auth preset when the request is sent.
          </div>
        ) : null}
      </div>
    </div>
  );
}

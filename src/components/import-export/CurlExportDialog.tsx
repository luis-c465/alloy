import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

import type { HttpRequestData, KeyValue as ApiKeyValue, MultipartField as ApiMultipartField, RequestBody } from "~/bindings";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { useActiveTab } from "~/hooks/useActiveTab";
import { exportCurl } from "~/lib/api";
import {
  getAuthorizationHeaderValue,
  getEnvironmentVariableMap,
  resolveTemplateString,
  type KeyValue,
  type MultipartField,
  type Tab,
} from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type CurlExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const getBaseUrl = (url: string): string => {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
};

const toApiKeyValue = (
  values: KeyValue[],
  variables: Map<string, string>,
): ApiKeyValue[] => values
  .filter((value) => value.enabled && value.key.trim().length > 0)
  .map(({ key, value, enabled }) => ({
    key: resolveTemplateString(key, variables),
    value: resolveTemplateString(value, variables),
    enabled,
  }));

const toApiMultipartField = (
  field: MultipartField,
  variables: Map<string, string>,
): ApiMultipartField => {
  const key = resolveTemplateString(field.key, variables);
  const contentType = field.content_type
    ? resolveTemplateString(field.content_type, variables)
    : null;

  if ("Text" in field.value) {
    return {
      key,
      value: { Text: resolveTemplateString(field.value.Text, variables) },
      content_type: contentType,
      enabled: field.enabled,
    };
  }

  return {
    key,
    value: {
      File: {
        path: resolveTemplateString(field.value.File.path, variables),
        filename: field.value.File.filename
          ? resolveTemplateString(field.value.File.filename, variables)
          : null,
      },
    },
    content_type: contentType,
    enabled: field.enabled,
  };
};

const buildExportRequest = (
  tab: Tab,
  environmentVariables: Map<string, string>,
): HttpRequestData => {
  const requestVariables = getEnvironmentVariableMap(tab.variables);
  const variables = new Map([...environmentVariables, ...requestVariables]);

  const filteredHeaders = tab.headers.filter((header) => {
    if (!header.enabled || !header.key.trim()) {
      return false;
    }

    if (tab.authType !== "none" && header.key.trim().toLowerCase() === "authorization") {
      return false;
    }

    return true;
  });

  const authHeaderValue = getAuthorizationHeaderValue(
    tab.authType,
    resolveTemplateString(tab.authBearer, variables),
    resolveTemplateString(tab.authBasicUsername, variables),
    resolveTemplateString(tab.authBasicPassword, variables),
  );

  const headers: ApiKeyValue[] = [
    ...toApiKeyValue(filteredHeaders, variables),
    ...(authHeaderValue
      ? [{ key: "Authorization", value: authHeaderValue, enabled: true }]
      : []),
  ];

  let body: RequestBody = "None";
  switch (tab.bodyType) {
    case "json":
      body = { Json: resolveTemplateString(tab.bodyContent, variables) };
      break;
    case "raw":
      body = {
        Raw: {
          content: resolveTemplateString(tab.bodyContent, variables),
          content_type: resolveTemplateString(tab.rawContentType, variables),
        },
      };
      break;
    case "form-urlencoded":
      body = { FormUrlEncoded: toApiKeyValue(tab.bodyFormData, variables) };
      break;
    case "form-data":
      body = {
        Multipart: tab.multipartFields
          .filter((field) => field.enabled && field.key.trim().length > 0)
          .map((field) => toApiMultipartField(field, variables)),
      };
      break;
    case "none":
    default:
      body = "None";
  }

  return {
    method: resolveTemplateString(tab.method, variables),
    url: resolveTemplateString(getBaseUrl(tab.url), variables),
    headers,
    query_params: toApiKeyValue(tab.queryParams, variables),
    body,
    timeout_ms: tab.timeoutMs,
    skip_ssl_verification: tab.skipSslVerification,
    request_variables: [],
  };
};

export function CurlExportDialog({ open, onOpenChange }: CurlExportDialogProps) {
  const activeTab = useActiveTab();
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const environments = useWorkspaceStore((state) => state.environments);
  const [curlCommand, setCurlCommand] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const environmentVariables = useMemo(() => {
    const variables = environments.find((environment) => environment.name === activeEnvironment)
      ?.variables ?? [];
    return getEnvironmentVariableMap(variables);
  }, [activeEnvironment, environments]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!activeTab) {
      setCurlCommand("");
      setError("No active request to export.");
      return;
    }

    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const payload = buildExportRequest(activeTab, environmentVariables);
        const nextCommand = await exportCurl(payload);
        if (!cancelled) {
          setCurlCommand(nextCommand);
        }
      } catch (exportError) {
        if (!cancelled) {
          setCurlCommand("");
          setError(exportError instanceof Error ? exportError.message : "Failed to export cURL.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeTab, environmentVariables, open]);

  const handleCopy = async () => {
    if (!curlCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export as cURL</DialogTitle>
          <DialogDescription>
            Generate a runnable cURL command for the active request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={error ?? (isLoading ? "Generating cURL command..." : curlCommand)}
            readOnly
            className="min-h-72 font-mono text-xs"
          />

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!curlCommand || isLoading || Boolean(error)}
          >
            {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

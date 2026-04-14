import { useMemo, useState } from "react";
import { IconArrowRight, IconTerminal2 } from "@tabler/icons-react";

import type {
  HttpRequestData,
  KeyValue as ApiKeyValue,
  MultipartField as ApiMultipartField,
} from "~/bindings";
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
import { importCurl } from "~/lib/api";
import { useRequestStore, type Tab } from "~/stores/request-store";

type CurlImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const withId = (value: ApiKeyValue) => ({
  ...value,
  id: crypto.randomUUID(),
});

const inferTabName = (request: HttpRequestData): string => {
  try {
    const parsed = new URL(buildTabUrl(request));
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || parsed.host || "Imported cURL";
  } catch {
    return request.url || "Imported cURL";
  }
};

const buildTabUrl = (request: HttpRequestData): string => {
  if (request.query_params.length === 0) {
    return request.url;
  }

  try {
    const parsed = new URL(request.url);
    for (const param of request.query_params.filter((param) => param.enabled)) {
      parsed.searchParams.append(param.key, param.value);
    }
    return parsed.toString();
  } catch {
    const suffix = request.query_params
      .filter((param) => param.enabled)
      .map((param) => `${param.key}=${param.value}`)
      .join("&");
    const separator = request.url.includes("?") ? "&" : "?";
    return suffix ? `${request.url}${separator}${suffix}` : request.url;
  }
};

const parseAuthFromHeaders = (
  headers: ApiKeyValue[],
): Pick<
  Tab,
  "authType" | "authBearer" | "authBasicUsername" | "authBasicPassword" | "headers"
> => {
  const nextHeaders = headers.map(withId);
  const authorizationIndex = nextHeaders.findIndex(
    (header) => header.enabled && header.key.trim().toLowerCase() === "authorization",
  );

  if (authorizationIndex < 0) {
    return {
      authType: "none",
      authBearer: "",
      authBasicUsername: "",
      authBasicPassword: "",
      headers: nextHeaders.length > 0 ? nextHeaders : [withId({ key: "", value: "", enabled: true })],
    };
  }

  const authorizationHeader = nextHeaders[authorizationIndex]!;
  const headerValue = authorizationHeader.value.trim();

  if (headerValue.startsWith("Bearer ")) {
    nextHeaders.splice(authorizationIndex, 1);
    return {
      authType: "bearer",
      authBearer: headerValue.slice("Bearer ".length),
      authBasicUsername: "",
      authBasicPassword: "",
      headers: nextHeaders.length > 0 ? nextHeaders : [withId({ key: "", value: "", enabled: true })],
    };
  }

  if (headerValue.startsWith("Basic ")) {
    const encoded = headerValue.slice("Basic ".length);
    try {
      const decoded = atob(encoded);
      const separatorIndex = decoded.indexOf(":");
      if (separatorIndex >= 0) {
        nextHeaders.splice(authorizationIndex, 1);
        return {
          authType: "basic",
          authBearer: "",
          authBasicUsername: decoded.slice(0, separatorIndex),
          authBasicPassword: decoded.slice(separatorIndex + 1),
          headers: nextHeaders.length > 0
            ? nextHeaders
            : [withId({ key: "", value: "", enabled: true })],
        };
      }
    } catch {
      // Keep the header as-is when it cannot be decoded safely.
    }
  }

  return {
    authType: "none",
    authBearer: "",
    authBasicUsername: "",
    authBasicPassword: "",
    headers: nextHeaders,
  };
};

const multipartFieldWithId = (field: ApiMultipartField) => ({
  ...field,
  id: crypto.randomUUID(),
  fileSizeBytes: null,
});

const requestToTabPatch = (request: HttpRequestData): Partial<Tab> => {
  const authState = parseAuthFromHeaders(request.headers);
  const common: Partial<Tab> = {
    name: inferTabName(request),
    requestName: null,
    filePath: null,
    requestIndex: null,
    isDirty: true,
    method: request.method || "GET",
    url: buildTabUrl(request),
    headers: authState.headers,
    queryParams: request.query_params.map(withId),
    skipSslVerification: request.skip_ssl_verification,
    timeoutMs: request.timeout_ms,
    response: null,
    error: null,
    isLoading: false,
    activeRequestTab: "params",
    activeResponseTab: "body",
    authType: authState.authType,
    authBearer: authState.authBearer,
    authBasicUsername: authState.authBasicUsername,
    authBasicPassword: authState.authBasicPassword,
  };

  if (request.body === "None") {
    return {
      ...common,
      bodyType: "none",
      bodyContent: "",
      bodyFormData: [],
      multipartFields: [],
      rawContentType: "text/plain",
    };
  }

  if ("Json" in request.body) {
    return {
      ...common,
      bodyType: "json",
      bodyContent: request.body.Json,
      bodyFormData: [],
      multipartFields: [],
      rawContentType: "application/json",
    };
  }

  if ("FormUrlEncoded" in request.body) {
    return {
      ...common,
      bodyType: "form-urlencoded",
      bodyContent: "",
      bodyFormData: request.body.FormUrlEncoded.map(withId),
      multipartFields: [],
      rawContentType: "text/plain",
    };
  }

  if ("Multipart" in request.body) {
    return {
      ...common,
      bodyType: "form-data",
      bodyContent: "",
      bodyFormData: [],
      multipartFields: request.body.Multipart.map(multipartFieldWithId),
      rawContentType: "text/plain",
    };
  }

  return {
    ...common,
    bodyType: "raw",
    bodyContent: request.body.Raw.content,
    bodyFormData: [],
    multipartFields: [],
    rawContentType: request.body.Raw.content_type,
  };
};

export function CurlImportDialog({ open, onOpenChange }: CurlImportDialogProps) {
  const createTab = useRequestStore((state) => state.createTab);
  const [curlCommand, setCurlCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const canImport = useMemo(() => curlCommand.trim().length > 0 && !isImporting, [curlCommand, isImporting]);

  const handleImport = async () => {
    const command = curlCommand.trim();
    if (!command) {
      setError("Paste a cURL command to import.");
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const request = await importCurl(command);
      void createTab(requestToTabPatch(request));
      setCurlCommand("");
      onOpenChange(false);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import cURL.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import cURL</DialogTitle>
          <DialogDescription>
            Paste a cURL command to open it as a new request tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Supports common flags like <span className="font-mono">-X</span>, <span className="font-mono">-H</span>, <span className="font-mono">-d</span>, <span className="font-mono">-F</span>, <span className="font-mono">-u</span>, <span className="font-mono">-k</span>, and <span className="font-mono">--max-time</span>.
          </div>

          <Textarea
            value={curlCommand}
            onChange={(event) => setCurlCommand(event.target.value)}
            placeholder="curl https://api.example.com -H 'Accept: application/json'"
            className="min-h-72 font-mono text-xs"
            spellCheck={false}
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
          <Button type="button" onClick={() => void handleImport()} disabled={!canImport}>
            {isImporting ? <IconTerminal2 className="size-3.5" /> : <IconArrowRight className="size-3.5" />}
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

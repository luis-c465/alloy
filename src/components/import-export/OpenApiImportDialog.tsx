import { useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCloudDownload,
  IconFileImport,
  IconFolderOpen,
  IconLink,
} from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  fetchOpenApiUrl,
  importOpenApi,
  pickOpenApiFile,
  previewOpenApi,
  type OpenApiImportOptions,
  type OpenApiPreview,
} from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

type OpenApiImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ImportPhase = "select" | "preview" | "done";
type ImportSource = "file" | "url";

const DEFAULT_OPTIONS: OpenApiImportOptions = {
  folder_strategy: "tags",
  naming_strategy: "operationId",
  include_deprecated: true,
  server_index: 0,
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
};

const formatRelativePath = (workspacePath: string, filePath: string): string => {
  if (filePath.startsWith(`${workspacePath}/`)) {
    return filePath.slice(workspacePath.length + 1);
  }

  if (filePath.startsWith(`${workspacePath}\\`)) {
    return filePath.slice(workspacePath.length + 1);
  }

  return filePath;
};

const formatMethodSummary = (methodCounts: [string, number][]): string => (
  methodCounts
    .filter(([, count]) => count > 0)
    .map(([method, count]) => `${method}×${count}`)
    .join(" · ")
);

export function OpenApiImportDialog({ open, onOpenChange }: OpenApiImportDialogProps) {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const refreshFileTree = useWorkspaceStore((state) => state.refreshFileTree);

  const [phase, setPhase] = useState<ImportPhase>("select");
  const [source, setSource] = useState<ImportSource>("file");
  const [urlInput, setUrlInput] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenApiPreview | null>(null);
  const [options, setOptions] = useState<OpenApiImportOptions>(DEFAULT_OPTIONS);
  const [createdFiles, setCreatedFiles] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }

    setPhase("select");
    setSource("file");
    setUrlInput("");
    setContent(null);
    setPreview(null);
    setOptions(DEFAULT_OPTIONS);
    setCreatedFiles([]);
    setImportWarnings([]);
    setError(null);
    setIsLoading(false);
  }, [open]);

  const canPreview = useMemo(
    () => Boolean(content && !isLoading),
    [content, isLoading],
  );

  const canImport = useMemo(
    () => Boolean(workspacePath && preview && content && !isLoading),
    [content, isLoading, preview, workspacePath],
  );

  const handlePickFile = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const selected = await pickOpenApiFile();
      if (!selected) {
        return;
      }

      setContent(selected);
      setPreview(null);
      setPhase("select");
    } catch (pickError) {
      setContent(null);
      setPreview(null);
      setError(getErrorMessage(pickError, "Failed to read selected OpenAPI file."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchUrl = async () => {
    if (!urlInput.trim()) {
      setError("Enter an OpenAPI URL first.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const fetched = await fetchOpenApiUrl(urlInput.trim());
      setContent(fetched);
      setPreview(null);
      setPhase("select");
    } catch (fetchError) {
      setContent(null);
      setPreview(null);
      setError(getErrorMessage(fetchError, "Failed to fetch OpenAPI URL."));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!content) {
      setError("Select a file or fetch a URL before previewing.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const nextPreview = await previewOpenApi(content);
      setPreview(nextPreview);
      setOptions((current) => ({
        ...current,
        server_index: Math.min(current.server_index, Math.max(nextPreview.servers.length - 1, 0)),
      }));
      setPhase("preview");
    } catch (previewError) {
      setPreview(null);
      setError(getErrorMessage(previewError, "Failed to preview OpenAPI spec."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!workspacePath) {
      setError("Open a workspace before importing an OpenAPI specification.");
      return;
    }

    if (!content) {
      setError("No OpenAPI content is loaded.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const result = await importOpenApi(content, workspacePath, options);
      setCreatedFiles(result.created_files);
      setImportWarnings(result.warnings);
      setPhase("done");
      await refreshFileTree();
    } catch (importError) {
      setCreatedFiles([]);
      setImportWarnings([]);
      setError(getErrorMessage(importError, "Failed to import OpenAPI spec."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import OpenAPI Spec</DialogTitle>
          <DialogDescription>
            Import OpenAPI 3.0/3.1 files and generate one <span className="font-mono">.http</span> file per operation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!workspacePath ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Open a workspace before importing an OpenAPI spec.
            </div>
          ) : null}

          {phase === "select" ? (
            <>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-1">
                <Button
                  type="button"
                  variant={source === "file" ? "default" : "ghost"}
                  className="h-7 px-3"
                  onClick={() => setSource("file")}
                >
                  File
                </Button>
                <Button
                  type="button"
                  variant={source === "url" ? "default" : "ghost"}
                  className="h-7 px-3"
                  onClick={() => setSource("url")}
                >
                  URL
                </Button>
              </div>

              {source === "file" ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium">OpenAPI file</div>
                    <div className="text-xs text-muted-foreground">
                      Pick a <span className="font-mono">.json</span>, <span className="font-mono">.yaml</span>, or <span className="font-mono">.yml</span> spec.
                    </div>
                  </div>

                  <Button type="button" variant="outline" onClick={() => void handlePickFile()} disabled={isLoading}>
                    <IconFolderOpen className="size-3.5" />
                    {isLoading ? "Selecting..." : "Select File"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-3">
                  <label htmlFor="openapi-url" className="text-xs font-medium text-foreground">OpenAPI URL</label>
                  <div className="flex gap-2">
                    <Input
                      id="openapi-url"
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      placeholder="https://example.com/openapi.yaml"
                      className="font-mono text-xs"
                    />
                    <Button type="button" variant="outline" onClick={() => void handleFetchUrl()} disabled={isLoading}>
                      <IconCloudDownload className="size-3.5" />
                      {isLoading ? "Fetching..." : "Fetch"}
                    </Button>
                  </div>
                </div>
              )}

              {content ? (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <IconLink className="mr-1 inline size-3.5" />
                  Source loaded. Continue to preview import settings.
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "preview" && preview ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-background px-3 py-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconFileImport className="size-4" />
                  {preview.title || "Imported OpenAPI"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Version {preview.version || "n/a"} · OpenAPI {preview.openapi_version || "unknown"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {preview.operation_count} {preview.operation_count === 1 ? "operation" : "operations"}
                  {preview.method_counts.length > 0 ? ` · ${formatMethodSummary(preview.method_counts)}` : ""}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground">Base URL</div>
                  <Select
                    value={String(options.server_index)}
                    onValueChange={(value) => {
                      const parsed = Number(value);
                      setOptions((current) => ({
                        ...current,
                        server_index: Number.isFinite(parsed) ? parsed : 0,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No servers in spec" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.servers.length === 0 ? (
                        <SelectItem value="0">(No server URL found)</SelectItem>
                      ) : preview.servers.map((server, index) => (
                        <SelectItem key={`${server}-${index}`} value={String(index)}>
                          {server}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground">Group files by</div>
                  <Select
                    value={options.folder_strategy}
                    onValueChange={(value: OpenApiImportOptions["folder_strategy"]) => {
                      setOptions((current) => ({ ...current, folder_strategy: value }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tags">Tags</SelectItem>
                      <SelectItem value="path">Path segment</SelectItem>
                      <SelectItem value="flat">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground">Request naming</div>
                  <Select
                    value={options.naming_strategy}
                    onValueChange={(value: OpenApiImportOptions["naming_strategy"]) => {
                      setOptions((current) => ({ ...current, naming_strategy: value }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operationId">operationId</SelectItem>
                      <SelectItem value="summary">summary</SelectItem>
                      <SelectItem value="methodPath">method + path</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <label className="mt-5 inline-flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={options.include_deprecated}
                    onChange={(event) => {
                      setOptions((current) => ({
                        ...current,
                        include_deprecated: event.target.checked,
                      }));
                    }}
                  />
                  Include deprecated operations
                </label>
              </div>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
              <div className="text-sm font-medium">Imported files</div>
              <ScrollArea className="h-40 rounded-md border border-border/60 bg-muted/10">
                <div className="space-y-1 p-2">
                  {createdFiles.map((filePath) => (
                    <div key={filePath} className="rounded-sm px-2 py-1 font-mono text-xs text-muted-foreground">
                      {workspacePath ? formatRelativePath(workspacePath, filePath) : filePath}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : null}

          {importWarnings.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {importWarnings.length} {importWarnings.length === 1 ? "warning" : "warnings"}
              </div>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                {importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

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

          {phase === "select" ? (
            <Button type="button" onClick={() => void handlePreview()} disabled={!canPreview}>
              <IconArrowRight className="size-3.5" />
              {isLoading ? "Previewing..." : "Preview"}
            </Button>
          ) : null}

          {phase === "preview" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPhase("select")} disabled={isLoading}>
                <IconArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button type="button" onClick={() => void handleImport()} disabled={!canImport}>
                <IconArrowRight className="size-3.5" />
                {isLoading ? "Importing..." : "Import"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

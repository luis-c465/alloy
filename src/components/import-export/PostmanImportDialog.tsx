import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconFileImport, IconFolderOpen } from "@tabler/icons-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { importPostmanCollection, pickImportFile } from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

type PostmanImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type CollectionPreview = {
  name: string;
  requestCount: number;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallback;
};

const countRequests = (items: unknown): number => {
  if (!Array.isArray(items)) {
    return 0;
  }

  return items.reduce((count, item) => {
    if (!item || typeof item !== "object") {
      return count;
    }

    const typedItem = item as { item?: unknown; request?: unknown };
    if (typedItem.request) {
      return count + 1;
    }

    return count + countRequests(typedItem.item);
  }, 0);
};

const parseCollectionPreview = (jsonContent: string): CollectionPreview => {
  const parsed = JSON.parse(jsonContent) as {
    info?: { name?: unknown };
    item?: unknown;
  };

  const name = typeof parsed.info?.name === "string" && parsed.info.name.trim().length > 0
    ? parsed.info.name
    : "Imported Postman Collection";
  const requestCount = countRequests(parsed.item);

  return { name, requestCount };
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

export function PostmanImportDialog({ open, onOpenChange }: PostmanImportDialogProps) {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const refreshFileTree = useWorkspaceStore((state) => state.refreshFileTree);
  const [jsonContent, setJsonContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [createdFiles, setCreatedFiles] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }

    setJsonContent(null);
    setPreview(null);
    setCreatedFiles([]);
    setError(null);
    setIsSelecting(false);
    setIsImporting(false);
  }, [open]);

  const canImport = useMemo(
    () => Boolean(workspacePath && jsonContent && preview && !isImporting),
    [isImporting, jsonContent, preview, workspacePath],
  );

  const handleSelectFile = async () => {
    setIsSelecting(true);
    setError(null);
    setCreatedFiles([]);

    try {
      const selectedContent = await pickImportFile();
      if (!selectedContent) {
        return;
      }

      const nextPreview = parseCollectionPreview(selectedContent);
      setJsonContent(selectedContent);
      setPreview(nextPreview);
    } catch (selectionError) {
      setJsonContent(null);
      setPreview(null);
      setError(getErrorMessage(selectionError, "Failed to read the selected Postman collection."));
    } finally {
      setIsSelecting(false);
    }
  };

  const handleImport = async () => {
    if (!workspacePath) {
      setError("Open a workspace before importing a Postman collection.");
      return;
    }

    if (!jsonContent) {
      setError("Select a Postman collection JSON file to import.");
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const result = await importPostmanCollection(jsonContent, workspacePath);
      setCreatedFiles(result.created_files);
      setImportWarnings(result.warnings);
      await refreshFileTree();
    } catch (importError) {
      setCreatedFiles([]);
      setImportWarnings([]);
      setError(getErrorMessage(importError, "Failed to import Postman collection."));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Postman Collection</DialogTitle>
          <DialogDescription>
            Select a Postman Collection v2 JSON export and create matching <span className="font-mono">.http</span> files in the current workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!workspacePath ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Open a workspace before importing a Postman collection.
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium">Postman collection JSON</div>
              <div className="text-xs text-muted-foreground">
                Pick a <span className="font-mono">.json</span> export from Postman to preview and import.
              </div>
            </div>

            <Button type="button" variant="outline" onClick={() => void handleSelectFile()} disabled={isSelecting || isImporting}>
              <IconFolderOpen className="size-3.5" />
              {isSelecting ? "Selecting..." : "Select File"}
            </Button>
          </div>

          {preview ? (
            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <IconFileImport className="size-4" />
                {preview.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {preview.requestCount} {preview.requestCount === 1 ? "request" : "requests"} ready to import.
              </div>
            </div>
          ) : null}

          {createdFiles.length > 0 ? (
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
                {importWarnings.length} {importWarnings.length === 1 ? "warning" : "warnings"} during import
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
          <Button type="button" onClick={() => void handleImport()} disabled={!canImport}>
            <IconArrowRight className="size-3.5" />
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

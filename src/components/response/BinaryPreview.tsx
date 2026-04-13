import {
  IconAlertCircle,
  IconBinary,
  IconDownload,
  IconPhoto,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { HexViewer } from "~/components/response/HexViewer";
import { Button } from "~/components/ui/button";
import { saveResponseToFile } from "~/lib/api";

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

interface BinaryPreviewProps {
  bodyBase64: string | null;
  contentType: string;
  sizeBytes: number;
  suggestedFilename: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(1)} MB`;
};

export function BinaryPreview({
  bodyBase64,
  contentType,
  sizeBytes,
  suggestedFilename,
}: BinaryPreviewProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = contentType.toLowerCase().startsWith("image/");
  const canPreviewImage = isImage && Boolean(bodyBase64) && sizeBytes <= MAX_INLINE_IMAGE_BYTES;
  const canShowHex = Boolean(bodyBase64);
  const imageSrc = useMemo(() => {
    if (!canPreviewImage || !bodyBase64) {
      return null;
    }

    return `data:${contentType};base64,${bodyBase64}`;
  }, [bodyBase64, canPreviewImage, contentType]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await saveResponseToFile(bodyBase64, suggestedFilename);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save response.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="rounded-md border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {isImage ? <IconPhoto className="size-4" /> : <IconBinary className="size-4" />}
              <span>{suggestedFilename}</span>
            </div>

            <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-3">
              <dt className="font-medium text-foreground">Content-Type</dt>
              <dd className="font-mono text-xs sm:text-sm">{contentType || "Unknown"}</dd>
              <dt className="font-medium text-foreground">Size</dt>
              <dd className="font-mono text-xs sm:text-sm">{formatBytes(sizeBytes)}</dd>
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              <IconDownload size={14} />
              {isSaving ? "Saving..." : "Save to File"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowHex((current) => !current)}
              disabled={!canShowHex}
            >
              {showHex ? "Hide Hex" : "View Hex"}
            </Button>
          </div>
        </div>

        {!canPreviewImage && isImage ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Inline preview is limited to images smaller than 2 MB.
          </p>
        ) : null}

        {!canShowHex ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Hex view is available for binary previews up to 5 MB.
          </p>
        ) : null}

        {error ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
            <IconAlertCircle className="size-4" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {imageSrc ? (
        <div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3">
          <img
            src={imageSrc}
            alt={suggestedFilename}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      ) : null}

      {showHex && bodyBase64 ? (
        <HexViewer bodyBase64={bodyBase64} sizeBytes={sizeBytes} />
      ) : null}
    </div>
  );
}

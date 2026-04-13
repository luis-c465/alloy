import { useMemo } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";

const HEX_PREVIEW_BYTES = 64 * 1024;
const ROW_BYTES = 16;

interface HexViewerProps {
  bodyBase64: string;
  sizeBytes: number;
}

interface HexRow {
  offset: string;
  left: string;
  right: string;
  ascii: string;
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

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const toAscii = (value: number): string => {
  return value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
};

const formatHexRow = (bytes: Uint8Array, offset: number): HexRow => {
  const row = bytes.slice(offset, offset + ROW_BYTES);
  const cells = Array.from(row, (value) => value.toString(16).padStart(2, "0"));
  const left = cells.slice(0, 8).join(" ").padEnd(23, " ");
  const right = cells.slice(8).join(" ").padEnd(23, " ");
  const ascii = Array.from(row, toAscii).join("");

  return {
    offset: offset.toString(16).padStart(8, "0"),
    left,
    right,
    ascii,
  };
};

export function HexViewer({ bodyBase64, sizeBytes }: HexViewerProps) {
  const { rows, isTruncated } = useMemo(() => {
    const decoded = decodeBase64(bodyBase64);
    const preview = decoded.slice(0, HEX_PREVIEW_BYTES);
    const nextRows: HexRow[] = [];

    for (let offset = 0; offset < preview.length; offset += ROW_BYTES) {
      nextRows.push(formatHexRow(preview, offset));
    }

    return {
      rows: nextRows,
      isTruncated: decoded.length > HEX_PREVIEW_BYTES || sizeBytes > HEX_PREVIEW_BYTES,
    };
  }, [bodyBase64, sizeBytes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/20">
      {isTruncated ? (
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Showing first 64 KB of {formatBytes(sizeBytes)}.
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="font-mono text-xs">
          {rows.map((row, index) => (
            <div
              key={row.offset}
              className={index % 2 === 0 ? "bg-background/70" : "bg-muted/30"}
            >
              <pre className="overflow-x-auto px-3 py-1.5 text-[11px] leading-5 text-foreground">{`${row.offset}  ${row.left}  ${row.right}  |${row.ascii}|`}</pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

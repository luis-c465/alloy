import { useActiveTabField } from "~/hooks/useActiveTab";

export function ResponseHeaders() {
  const response = useActiveTabField("response", null);

  if (!response || response.headers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No response headers
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-md border border-border">
      {response.headers.map((header, index) => (
        <div
          key={`${header.key}-${index}`}
          className={`grid grid-cols-[minmax(180px,35%)_1fr] gap-3 px-3 py-2 text-sm ${
            index % 2 === 0 ? "bg-background" : "bg-muted/30"
          }`}
        >
          <span className="font-mono text-muted-foreground">{header.key}</span>
          <span className="font-mono break-all">{header.value}</span>
        </div>
      ))}
    </div>
  );
}

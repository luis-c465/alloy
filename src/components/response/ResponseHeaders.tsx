import { useMemo, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";

import { useActiveTabField } from "~/hooks/useActiveTab";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";

export function ResponseHeaders() {
  const layoutState = useDefaultLayout({
    id: "response-headers-columns",
    panelIds: ["key", "value"],
    storage: window.localStorage,
  });
  const [columnLayout, setColumnLayout] = useState<Record<string, number>>(
    layoutState.defaultLayout ?? { key: 35, value: 65 },
  );

  const response = useActiveTabField("response", null);

  const rowGridTemplate = useMemo(() => {
    const key = columnLayout.key ?? 35;
    const value = columnLayout.value ?? 65;
    return `minmax(180px, ${key}fr) minmax(200px, ${value}fr)`;
  }, [columnLayout]);

  if (!response || response.headers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No response headers
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-md border border-border">
      <div
        className="grid border-b border-border bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: rowGridTemplate }}
      >
        <ResizablePanelGroup
          orientation="horizontal"
          id="response-headers-columns"
          className="col-span-2 min-w-0 items-center"
          defaultLayout={layoutState.defaultLayout}
          onLayoutChange={setColumnLayout}
          onLayoutChanged={layoutState.onLayoutChanged}
        >
          <ResizablePanel id="key" minSize="18%" defaultSize="35%">
            <span className="block px-1">Header</span>
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1 bg-border/80 w-[12px]!" />
          <ResizablePanel id="value" minSize="25%" defaultSize="65%">
            <span className="block px-1">Value</span>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {response.headers.map((header, index) => (
        <div
          key={`${header.key}-${index}`}
          className={`grid gap-3 px-3 py-2 text-sm ${
            index % 2 === 0 ? "bg-background" : "bg-muted/30"
          }`}
          style={{ gridTemplateColumns: rowGridTemplate }}
        >
          <span className="font-mono text-muted-foreground">{header.key}</span>
          <span className="font-mono break-all">{header.value}</span>
        </div>
      ))}
    </div>
  );
}

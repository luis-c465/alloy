import type { KeyboardEvent } from "react";

import { useActiveTabField } from "~/hooks/useActiveTab";
import { Input } from "~/components/ui/input";
import { useRequestStore } from "~/stores/request-store";

export function UrlBar() {
  const url = useActiveTabField("url", "");
  const setUrl = useRequestStore((state) => state.setUrl);
  const syncUrlToQueryParams = useRequestStore(
    (state) => state.syncUrlToQueryParams,
  );
  const sendRequest = useRequestStore((state) => state.sendRequest);

  const handleChange = (value: string) => {
    setUrl(value);
    syncUrlToQueryParams();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      void sendRequest();
    }
  };

  return (
    <Input
      type="text"
      value={url}
      placeholder="Enter request URL..."
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={handleKeyDown}
      className="h-8 flex-1 font-mono text-sm"
    />
  );
}

import { useCallback, useRef } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((value: string) => {
    setUrl(value);
    syncUrlToQueryParams();
  }, [setUrl, syncUrlToQueryParams]);

  useHotkey(
    "Enter",
    () => {
      void sendRequest();
    },
    { target: inputRef, ignoreInputs: false, preventDefault: true },
  );

  return (
    <Input
      type="text"
      value={url}
      placeholder="Enter request URL..."
      onChange={(event) => handleChange(event.target.value)}
      ref={inputRef}
      className="h-8 flex-1 font-mono text-sm"
    />
  );
}

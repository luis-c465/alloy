import { useCallback } from "react";

import { useActiveTabField } from "~/hooks/useActiveTab";
import { VariableInput } from "~/components/ui/VariableInput";
import { useRequestStore } from "~/stores/request-store";

export function UrlBar() {
  const url = useActiveTabField("url", "");
  const setUrl = useRequestStore((state) => state.setUrl);
  const syncUrlToQueryParams = useRequestStore(
    (state) => state.syncUrlToQueryParams,
  );
  const sendRequest = useRequestStore((state) => state.sendRequest);

  const handleChange = useCallback(
    (value: string) => {
      setUrl(value);
      syncUrlToQueryParams();
    },
    [setUrl, syncUrlToQueryParams],
  );

  const handleEnter = useCallback(() => {
    void sendRequest();
  }, [sendRequest]);

  return (
    <VariableInput
      value={url}
      placeholder="Enter request URL..."
      onChange={handleChange}
      onEnter={handleEnter}
      singleLine
      className="h-8 flex-1"
    />
  );
}

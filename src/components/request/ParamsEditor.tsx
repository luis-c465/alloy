import { memo, useCallback } from "react";
import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

export const ParamsEditor = memo(function ParamsEditor() {
  const queryParams = useActiveTabField("queryParams", []);
  const setQueryParams = useRequestStore((state) => state.setQueryParams);
  const syncQueryParamsToUrl = useRequestStore(
    (state) => state.syncQueryParamsToUrl,
  );

  const handleChange = useCallback((items: typeof queryParams) => {
    setQueryParams(items);
    syncQueryParamsToUrl();
  }, [setQueryParams, syncQueryParamsToUrl]);

  return (
    <KeyValueEditor
      items={queryParams}
      onChange={handleChange}
      keyPlaceholder="Parameter name"
      valuePlaceholder="Value"
    />
  );
});

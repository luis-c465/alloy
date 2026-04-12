import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { useRequestStore } from "~/stores/request-store";

export function ParamsEditor() {
  const queryParams = useRequestStore((state) => state.queryParams);
  const setQueryParams = useRequestStore((state) => state.setQueryParams);
  const syncQueryParamsToUrl = useRequestStore((state) => state.syncQueryParamsToUrl);

  const handleChange = (items: typeof queryParams) => {
    setQueryParams(items);
    syncQueryParamsToUrl();
  };

  return (
    <KeyValueEditor
      items={queryParams}
      onChange={handleChange}
      keyPlaceholder="Parameter name"
      valuePlaceholder="Value"
    />
  );
}

import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { useRequestStore } from "~/stores/request-store";

export function HeadersEditor() {
  const headers = useRequestStore((state) => state.headers);
  const setHeaders = useRequestStore((state) => state.setHeaders);

  return (
    <KeyValueEditor
      items={headers}
      onChange={setHeaders}
      keyPlaceholder="Header name"
      valuePlaceholder="Value"
    />
  );
}

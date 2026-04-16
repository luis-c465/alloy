import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { useActiveTabField } from "~/hooks/useActiveTab";
import { useRequestStore } from "~/stores/request-store";

export function VariablesEditor() {
  const variables = useActiveTabField("variables", []);
  const setVariables = useRequestStore((state) => state.setVariables);

  return (
    <KeyValueEditor
      items={variables}
      onChange={setVariables}
      keyPlaceholder="Variable name"
      valuePlaceholder="Value"
    />
  );
}

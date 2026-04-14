import { useEffect, useMemo, useState } from "react";
import { IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";

import type { EnvironmentData } from "~/bindings";
import { KeyValueEditor } from "~/components/request/KeyValueEditor";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  deleteEnvironment,
  saveEnvironment,
  setActiveEnvironment as setActiveEnvironmentApi,
} from "~/lib/api";
import { useEnvironments } from "~/hooks/useEnvironments";
import type { KeyValue } from "~/stores/request-store";
import { useWorkspaceStore } from "~/stores/workspace-store";

type EnvironmentEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const toEditorVariables = (variables: EnvironmentData["variables"]): KeyValue[] =>
  variables.map((variable) => ({
    key: variable.key,
    value: variable.value,
    enabled: variable.enabled,
    id: crypto.randomUUID(),
  }));

const toApiVariables = (variables: KeyValue[]): EnvironmentData["variables"] =>
  variables
    .filter((variable) => variable.enabled && variable.key.trim().length > 0)
    .map(({ key, value, enabled }) => ({ key: key.trim(), value, enabled }));

const sanitizeEnvironmentName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-");

export function EnvironmentEditor({
  open,
  onOpenChange,
}: EnvironmentEditorProps) {
  const workspacePath = useWorkspaceStore((state) => state.workspacePath);
  const environments = useWorkspaceStore((state) => state.environments);
  const activeEnvironment = useWorkspaceStore((state) => state.activeEnvironment);
  const environmentsQuery = useEnvironments(workspacePath);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftVariables, setDraftVariables] = useState<KeyValue[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const selectedEnvironment = useMemo(
    () => environments.find((environment) => environment.name === selectedName) ?? null,
    [environments, selectedName],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const preferredName =
      selectedName ?? activeEnvironment ?? environments[0]?.name ?? null;

    setSelectedName(preferredName);

    const preferredEnvironment =
      environments.find((environment) => environment.name === preferredName) ?? null;
    setDraftVariables(toEditorVariables(preferredEnvironment?.variables ?? []));
  }, [activeEnvironment, environments, open, selectedName]);

  const handleSelectEnvironment = (name: string) => {
    const nextEnvironment =
      environments.find((environment) => environment.name === name) ?? null;
    setSelectedName(name);
    setDraftVariables(toEditorVariables(nextEnvironment?.variables ?? []));
  };

  const handleCreateEnvironment = async () => {
    if (!workspacePath || isSaving) {
      return;
    }

    const rawName = window.prompt("Environment name");
    if (!rawName) {
      return;
    }

    const name = sanitizeEnvironmentName(rawName);
    if (!name) {
      window.alert("Please enter a valid environment name.");
      return;
    }

    const exists = environments.some(
      (environment) => environment.name.toLowerCase() === name.toLowerCase(),
    );

    if (exists) {
      window.alert("An environment with that name already exists.");
      return;
    }

    setIsSaving(true);
    try {
      await saveEnvironment(workspacePath, { name, variables: [] });
      await environmentsQuery.refetch();
      setSelectedName(name);
      setDraftVariables([]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEnvironment = async () => {
    if (!workspacePath || !selectedEnvironment || isSaving) {
      return;
    }

    const confirmed = window.confirm(
      `Delete environment "${selectedEnvironment.name}"?`,
    );
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    try {
      await deleteEnvironment(workspacePath, selectedEnvironment.name);

      if (activeEnvironment === selectedEnvironment.name) {
        await setActiveEnvironmentApi(workspacePath, null);
      }

      const refreshed = await environmentsQuery.refetch();
      const nextName = (refreshed.data?.environments ?? environments).find(
        (environment) => environment.name !== selectedEnvironment.name,
      )?.name;
      setSelectedName(nextName ?? null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEnvironment = async () => {
    if (!workspacePath || !selectedName || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      await saveEnvironment(workspacePath, {
        name: selectedName,
        variables: toApiVariables(draftVariables),
      });
      await environmentsQuery.refetch();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex min-h-[75vh] max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Manage Environments</DialogTitle>
          <DialogDescription>
            Define key/value variables to use in request templates like {"{{base_url}}"}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-4">
          <div className="flex min-h-0 flex-col rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border p-2">
              <span className="text-xs font-medium text-muted-foreground">Environments</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  void handleCreateEnvironment();
                }}
                disabled={!workspacePath || isSaving}
                aria-label="Create environment"
              >
                <IconPlus className="size-3.5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-1">
              {environments.length === 0 ? (
                <div className="rounded-md p-2 text-xs text-muted-foreground">
                  No environments yet.
                </div>
              ) : (
                environments.map((environment) => {
                  const isSelected = environment.name === selectedName;
                  return (
                    <button
                      key={environment.name}
                      type="button"
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60"
                      }`}
                      onClick={() => {
                        handleSelectEnvironment(environment.name);
                      }}
                    >
                      {environment.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">
                  {selectedName ?? "Select an environment"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Variables are resolved at send-time and in URL preview.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleDeleteEnvironment();
                }}
                disabled={!selectedEnvironment || isSaving}
              >
                <IconTrash className="size-3.5" />
                Delete
              </Button>
            </div>

            <div className="min-h-0 flex-1">
              {selectedEnvironment ? (
                <KeyValueEditor
                  items={draftVariables}
                  onChange={setDraftVariables}
                  keyPlaceholder="Variable name"
                  valuePlaceholder="Variable value"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                  Select or create an environment to edit variables.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSaveEnvironment();
            }}
            disabled={!selectedEnvironment || isSaving}
          >
            <IconDeviceFloppy className="size-3.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

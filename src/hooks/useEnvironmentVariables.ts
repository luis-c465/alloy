import { useMemo } from "react"

import type { KeyValue } from "~/bindings"
import { useRequestStore } from "~/stores/request-store"
import { useWorkspaceStore } from "~/stores/workspace-store"

const EMPTY_VARIABLES: KeyValue[] = []

export function useEnvironmentVariables(): Record<string, string> {
  const environmentVariables = useWorkspaceStore((state) => {
    const activeName = state.activeEnvironment
    if (!activeName) {
      return EMPTY_VARIABLES
    }

    const env = state.environments.find((environment) => environment.name === activeName)
    if (!env) {
      return EMPTY_VARIABLES
    }

    return env.variables
  })

  const requestVariables = useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id
    if (!activeTabId) {
      return EMPTY_VARIABLES
    }

    const activeTab = state.tabs.find((tab) => tab.id === activeTabId)
    return activeTab?.variables ?? EMPTY_VARIABLES
  })

  return useMemo(() => {
    const result: Record<string, string> = {}

    for (const variable of environmentVariables) {
      if (variable.enabled && variable.key.trim()) {
        result[variable.key.trim()] = variable.value
      }
    }

    for (const variable of requestVariables) {
      if (variable.enabled && variable.key.trim()) {
        result[variable.key.trim()] = variable.value
      }
    }

    return result
  }, [environmentVariables, requestVariables])
}

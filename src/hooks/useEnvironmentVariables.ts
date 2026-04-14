import { useMemo } from "react"

import type { KeyValue } from "~/bindings"
import { useWorkspaceStore } from "~/stores/workspace-store"

const EMPTY_VARIABLES: KeyValue[] = []

export function useEnvironmentVariables(): Record<string, string> {
  const variables = useWorkspaceStore((state) => {
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

  return useMemo(() => {
    const result: Record<string, string> = {}

    for (const variable of variables) {
      if (variable.enabled && variable.key.trim()) {
        result[variable.key.trim()] = variable.value
      }
    }

    return result
  }, [variables])
}

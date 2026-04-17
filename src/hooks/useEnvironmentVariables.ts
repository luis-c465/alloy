import { useMemo } from "react"

import type { KeyValue } from "~/bindings"
import { useRequestStore } from "~/stores/request-store"
import { useWorkspaceStore } from "~/stores/workspace-store"

const EMPTY_VARIABLES: KeyValue[] = []

export function useEnvironmentVariables(): Record<string, string> {
  const filePath = useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id
    if (!activeTabId) {
      return null
    }

    const activeTab = state.tabs.find((tab) => tab.id === activeTabId)
    if (activeTab?.tabType !== "request") {
      return null
    }

    return activeTab.filePath
  })

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
  const folderConfigs = useWorkspaceStore((state) => state.folderConfigs)
  const getFolderConfigChain = useWorkspaceStore((state) => state.getFolderConfigChain)

  const requestVariables = useRequestStore((state) => {
    const activeTabId = state.activeTabId ?? state.tabs[0]?.id
    if (!activeTabId) {
      return EMPTY_VARIABLES
    }

    const activeTab = state.tabs.find((tab) => tab.id === activeTabId)
    if (activeTab?.tabType !== "request") {
      return EMPTY_VARIABLES
    }
    return activeTab?.variables ?? EMPTY_VARIABLES
  })

  const folderVariables = useMemo(() => {
    if (!filePath) {
      return EMPTY_VARIABLES
    }

    if (Object.keys(folderConfigs).length === 0) {
      return EMPTY_VARIABLES
    }

    return getFolderConfigChain(filePath).flatMap((entry) => entry.config.variables)
  }, [filePath, folderConfigs, getFolderConfigChain])

  return useMemo(() => {
    const result: Record<string, string> = {}

    for (const variable of environmentVariables) {
      if (variable.enabled && variable.key.trim()) {
        result[variable.key.trim()] = variable.value
      }
    }

    for (const variable of folderVariables) {
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
  }, [environmentVariables, folderVariables, requestVariables])
}

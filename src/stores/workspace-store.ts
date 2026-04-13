import { create } from "zustand";

import type { EnvironmentData, FileEntry } from "~/bindings";
import { api } from "~/lib/api";
import { SIDEBAR_TABS } from "~/lib/constants";

type SidebarTab = (typeof SIDEBAR_TABS)[number];

interface WorkspaceStore {
  workspacePath: string | null;
  workspaceName: string | null;
  activeEnvironment: string | null;
  environments: EnvironmentData[];
  sidebarVisible: boolean;
  sidebarTab: SidebarTab;
  fileTree: FileEntry[];
  setWorkspace: (path: string | null) => Promise<void>;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setActiveEnvironment: (name: string | null) => void;
  setEnvironments: (environments: EnvironmentData[]) => void;
  setFileTree: (tree: FileEntry[]) => void;
  refreshFileTree: () => Promise<void>;
}

const getWorkspaceName = (path: string): string => {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  workspacePath: null,
  workspaceName: null,
  activeEnvironment: null,
  environments: [],
  sidebarVisible: true,
  sidebarTab: SIDEBAR_TABS[0],
  fileTree: [],
  setWorkspace: async (path) => {
    if (!path) {
      set({
        workspacePath: null,
        workspaceName: null,
        activeEnvironment: null,
        environments: [],
        fileTree: [],
      });
      return;
    }

    set({
      workspacePath: path,
      workspaceName: getWorkspaceName(path),
      activeEnvironment: null,
      environments: [],
      fileTree: [],
    });
  },
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setActiveEnvironment: (activeEnvironment) => set({ activeEnvironment }),
  setEnvironments: (environments) => set({ environments }),
  setFileTree: (fileTree) => set({ fileTree }),
  refreshFileTree: async () => {
    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      set({ fileTree: [] });
      return;
    }

    const files = await api.workspace.list_files(workspacePath);
    set({ fileTree: files });
  },
}));

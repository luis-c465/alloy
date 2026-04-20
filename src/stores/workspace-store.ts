import { create } from "zustand";

import type { EnvironmentData, FileEntry } from "~/bindings";
import { api, listFolderConfigs, type FolderConfig } from "~/lib/api";
import { joinPath } from "~/lib/path";
import { SIDEBAR_TABS } from "~/lib/constants";

type SidebarTab = (typeof SIDEBAR_TABS)[number];

export type SidebarTrigger =
  | { type: "new-file"; parentPath: string }
  | { type: "new-folder"; parentPath: string }
  | { type: "folder-properties"; folderPath: string };

interface WorkspaceStore {
  workspacePath: string | null;
  workspaceName: string | null;
  activeEnvironment: string | null;
  environments: EnvironmentData[];
  sidebarVisible: boolean;
  sidebarTab: SidebarTab;
  fileTree: FileEntry[];
  selectedPath: string | null;
  expandedState: Record<string, boolean>;
  folderConfigs: Record<string, FolderConfig>;
  /** Pending trigger from outside the sidebar (e.g. breadcrumb context menu). Consumed and cleared by CollectionsPanel. */
  pendingSidebarTrigger: SidebarTrigger | null;
  initWorkspace: () => Promise<void>;
  setWorkspace: (path: string | null) => Promise<void>;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setActiveEnvironment: (name: string | null) => void;
  setEnvironments: (environments: EnvironmentData[]) => void;
  setFileTree: (tree: FileEntry[]) => void;
  setSelectedPath: (path: string | null) => void;
  setPathExpanded: (path: string, expanded: boolean) => void;
  revealPath: (path: string) => void;
  refreshFileTree: () => Promise<void>;
  refreshFolderConfigs: () => Promise<void>;
  setFolderConfigCache: (folderPath: string, config: FolderConfig) => void;
  getFolderConfig: (folderPath: string) => FolderConfig | null;
  getFolderConfigChain: (filePath: string | null) => Array<{ folderPath: string; config: FolderConfig }>;
  dispatchSidebarTrigger: (trigger: SidebarTrigger) => void;
  clearSidebarTrigger: () => void;
}

const LAST_WORKSPACE_KEY = "alloy-last-workspace";

const isBrowser = (): boolean => typeof window !== "undefined";

const readStoredWorkspacePath = (): string | null => {
  if (!isBrowser()) {
    return null;
  }

  const storedPath = window.localStorage.getItem(LAST_WORKSPACE_KEY);
  return storedPath?.trim() ? storedPath : null;
};

const getWorkspaceName = (path: string): string => {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

const normalizePath = (path: string): string => path
  .replace(/\\/g, "/")
  .replace(/^\/\/(?:\?|\.)\//, "")
  .replace(/\/+$/, "");

const isWindowsStylePath = (path: string): boolean => /^[a-z]:\//i.test(path) || path.startsWith("//");

const pathsEqual = (left: string, right: string): boolean => {
  if (isWindowsStylePath(left) || isWindowsStylePath(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
};

const startsWithPathPrefix = (path: string, prefix: string): boolean => {
  if (isWindowsStylePath(path) || isWindowsStylePath(prefix)) {
    return path.toLowerCase().startsWith(prefix.toLowerCase());
  }

  return path.startsWith(prefix);
};

const getPathSeparator = (path: string): string => (
  path.includes("\\") && !path.includes("/") ? "\\" : "/"
);

const joinPathWithSeparator = (basePath: string, segment: string): string => {
  const separator = getPathSeparator(basePath);
  if (basePath.endsWith("/") || basePath.endsWith("\\")) {
    return `${basePath}${segment}`;
  }

  return `${basePath}${separator}${segment}`;
};

const buildFolderChain = (workspacePath: string, filePath: string): string[] => {
  const segments = getRelativeSegments(workspacePath, filePath);
  const folderSegments = segments.slice(0, Math.max(0, segments.length - 1));
  const chain = [workspacePath];
  let currentPath = workspacePath;

  for (const segment of folderSegments) {
    currentPath = joinPathWithSeparator(currentPath, segment);
    chain.push(currentPath);
  }

  return chain;
};

const getRelativeSegments = (
  workspacePath: string | null,
  targetPath: string,
): string[] => {
  const normalizedTarget = normalizePath(targetPath);
  if (!workspacePath) {
    return normalizedTarget.split("/").filter(Boolean);
  }

  const normalizedWorkspace = normalizePath(workspacePath);
  if (pathsEqual(normalizedTarget, normalizedWorkspace)) {
    return [];
  }

  const workspacePrefix = `${normalizedWorkspace}/`;
  if (startsWithPathPrefix(normalizedTarget, workspacePrefix)) {
    return normalizedTarget.slice(workspacePrefix.length).split("/").filter(Boolean);
  }

  return normalizedTarget.split("/").filter(Boolean);
};

const findEntryByPath = (entries: FileEntry[], targetPath: string): FileEntry | null => {
  for (const entry of entries) {
    if (entry.path === targetPath) {
      return entry;
    }

    const children = entry.children ?? [];
    if (children.length === 0) {
      continue;
    }

    const match = findEntryByPath(children, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
};

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  workspacePath: null,
  workspaceName: null,
  activeEnvironment: null,
  environments: [],
  sidebarVisible: true,
  sidebarTab: SIDEBAR_TABS[0],
  fileTree: [],
  selectedPath: null,
  expandedState: {},
  folderConfigs: {},
  pendingSidebarTrigger: null,
  initWorkspace: async () => {
    const path = readStoredWorkspacePath();
    if (!path) {
      return;
    }

    try {
      await api.workspace.ensure_workspace(path);
      await get().setWorkspace(path);
    } catch {
      if (isBrowser()) {
        window.localStorage.removeItem(LAST_WORKSPACE_KEY);
      }
    }
  },
  setWorkspace: async (path) => {
    if (!path) {
      if (isBrowser()) {
        window.localStorage.removeItem(LAST_WORKSPACE_KEY);
      }

      set({
        workspacePath: null,
        workspaceName: null,
        activeEnvironment: null,
        environments: [],
        fileTree: [],
        selectedPath: null,
        expandedState: {},
        folderConfigs: {},
      });
      return;
    }

    if (isBrowser()) {
      window.localStorage.setItem(LAST_WORKSPACE_KEY, path);
    }

    set({
      workspacePath: path,
      workspaceName: getWorkspaceName(path),
      activeEnvironment: null,
      environments: [],
      fileTree: [],
      selectedPath: null,
      expandedState: {},
      folderConfigs: {},
    });

    await get().refreshFolderConfigs();
  },
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setActiveEnvironment: (activeEnvironment) => set({ activeEnvironment }),
  setEnvironments: (environments) => set({ environments }),
  setFileTree: (fileTree) => set({ fileTree }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),
  setPathExpanded: (path, expanded) => {
    set((state) => ({
      expandedState: {
        ...state.expandedState,
        [path]: expanded,
      },
    }));
  },
  revealPath: (path) => {
    const workspacePath = get().workspacePath;
    const segments = getRelativeSegments(workspacePath, path);
    const folderSegments = segments.slice(0, Math.max(0, segments.length - 1));

    set((state) => {
      const nextExpandedState = { ...state.expandedState };
      const entry = findEntryByPath(state.fileTree, path);

      if (workspacePath) {
        let currentPath = workspacePath;
        for (const segment of folderSegments) {
          currentPath = joinPath(currentPath, segment);
          nextExpandedState[currentPath] = true;
        }

        if (entry?.is_dir) {
          nextExpandedState[path] = true;
        }
      }

      return {
        selectedPath: path,
        sidebarVisible: true,
        sidebarTab: "collections",
        expandedState: nextExpandedState,
      };
    });
  },
  refreshFileTree: async () => {
    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      set({ fileTree: [], folderConfigs: {} });
      return;
    }

    const [files, entries] = await Promise.all([
      api.workspace.list_files(workspacePath),
      listFolderConfigs(workspacePath),
    ]);
    const nextCache: Record<string, FolderConfig> = {};
    for (const entry of entries) {
      nextCache[entry.folder_path] = entry.config;
    }

    set({ fileTree: files, folderConfigs: nextCache });
  },
  refreshFolderConfigs: async () => {
    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      set({ folderConfigs: {} });
      return;
    }

    const entries = await listFolderConfigs(workspacePath);
    const nextCache: Record<string, FolderConfig> = {};
    for (const entry of entries) {
      nextCache[entry.folder_path] = entry.config;
    }

    set({ folderConfigs: nextCache });
  },
  setFolderConfigCache: (folderPath, config) => {
    set((state) => ({
      folderConfigs: {
        ...state.folderConfigs,
        [folderPath]: config,
      },
    }));
  },
  getFolderConfig: (folderPath) => {
    const config = get().folderConfigs[folderPath];
    return config ?? null;
  },
  getFolderConfigChain: (filePath) => {
    if (!filePath) {
      return [];
    }

    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      return [];
    }

    const chain = buildFolderChain(workspacePath, filePath);
    const cache = get().folderConfigs;
    return chain
      .filter((folderPath) => Boolean(cache[folderPath]))
      .map((folderPath) => ({ folderPath, config: cache[folderPath]! }));
  },
  dispatchSidebarTrigger: (trigger) => set({ pendingSidebarTrigger: trigger }),
  clearSidebarTrigger: () => set({ pendingSidebarTrigger: null }),
}));

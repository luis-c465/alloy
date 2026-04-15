import { createContext, type ReactNode, useContext } from "react";

import type { FileEntry } from "~/bindings";

export type PendingCreation = {
  type: "file" | "folder";
  parentPath: string;
  name: string;
};

export type FileTreeContextValue = {
  activeFilePath: string | null;
  selectedPath: string | null;
  expandedState: Record<string, boolean>;
  isBusy: boolean;
  renamingPath: string | null;
  renameDraft: string;
  pendingCreation: PendingCreation | null;
  onSelect: (entry: FileEntry) => void;
  onToggleDirectory: (path: string, expanded: boolean) => void;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onPendingNameChange: (value: string) => void;
  onSubmitCreate: () => void;
  onCancelCreate: () => void;
  onBeginRename: (entry: FileEntry) => void;
  onRenameDraftChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onDelete: (entry: FileEntry) => void;
};

type FileTreeContextProviderProps = FileTreeContextValue & {
  children: ReactNode;
};

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function FileTreeContextProvider({
  children,
  activeFilePath,
  selectedPath,
  expandedState,
  isBusy,
  renamingPath,
  renameDraft,
  pendingCreation,
  onSelect,
  onToggleDirectory,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onPendingNameChange,
  onSubmitCreate,
  onCancelCreate,
  onBeginRename,
  onRenameDraftChange,
  onSubmitRename,
  onCancelRename,
  onDelete,
}: FileTreeContextProviderProps) {
  return (
    <FileTreeContext.Provider
      value={{
        activeFilePath,
        selectedPath,
        expandedState,
        isBusy,
        renamingPath,
        renameDraft,
        pendingCreation,
        onSelect,
        onToggleDirectory,
        onOpenFile,
        onCreateFile,
        onCreateFolder,
        onPendingNameChange,
        onSubmitCreate,
        onCancelCreate,
        onBeginRename,
        onRenameDraftChange,
        onSubmitRename,
        onCancelRename,
        onDelete,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}

export function useFileTreeContext() {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error("useFileTreeContext must be used within a FileTreeContextProvider");
  }

  return context;
}

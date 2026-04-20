import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from "react";

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
  onEditFolderProperties: (entry: FileEntry) => void;
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
  onEditFolderProperties,
}: FileTreeContextProviderProps) {
  const onSelectRef = useRef(onSelect);
  const onToggleDirectoryRef = useRef(onToggleDirectory);
  const onOpenFileRef = useRef(onOpenFile);
  const onCreateFileRef = useRef(onCreateFile);
  const onCreateFolderRef = useRef(onCreateFolder);
  const onPendingNameChangeRef = useRef(onPendingNameChange);
  const onSubmitCreateRef = useRef(onSubmitCreate);
  const onCancelCreateRef = useRef(onCancelCreate);
  const onBeginRenameRef = useRef(onBeginRename);
  const onRenameDraftChangeRef = useRef(onRenameDraftChange);
  const onSubmitRenameRef = useRef(onSubmitRename);
  const onCancelRenameRef = useRef(onCancelRename);
  const onDeleteRef = useRef(onDelete);
  const onEditFolderPropertiesRef = useRef(onEditFolderProperties);

  onSelectRef.current = onSelect;
  onToggleDirectoryRef.current = onToggleDirectory;
  onOpenFileRef.current = onOpenFile;
  onCreateFileRef.current = onCreateFile;
  onCreateFolderRef.current = onCreateFolder;
  onPendingNameChangeRef.current = onPendingNameChange;
  onSubmitCreateRef.current = onSubmitCreate;
  onCancelCreateRef.current = onCancelCreate;
  onBeginRenameRef.current = onBeginRename;
  onRenameDraftChangeRef.current = onRenameDraftChange;
  onSubmitRenameRef.current = onSubmitRename;
  onCancelRenameRef.current = onCancelRename;
  onDeleteRef.current = onDelete;
  onEditFolderPropertiesRef.current = onEditFolderProperties;

  const handleSelect = useCallback((entry: FileEntry) => {
    onSelectRef.current(entry);
  }, []);

  const handleToggleDirectory = useCallback((path: string, expanded: boolean) => {
    onToggleDirectoryRef.current(path, expanded);
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    onOpenFileRef.current(path);
  }, []);

  const handleCreateFile = useCallback((parentPath: string) => {
    onCreateFileRef.current(parentPath);
  }, []);

  const handleCreateFolder = useCallback((parentPath: string) => {
    onCreateFolderRef.current(parentPath);
  }, []);

  const handlePendingNameChange = useCallback((value: string) => {
    onPendingNameChangeRef.current(value);
  }, []);

  const handleSubmitCreate = useCallback(() => {
    onSubmitCreateRef.current();
  }, []);

  const handleCancelCreate = useCallback(() => {
    onCancelCreateRef.current();
  }, []);

  const handleBeginRename = useCallback((entry: FileEntry) => {
    onBeginRenameRef.current(entry);
  }, []);

  const handleRenameDraftChange = useCallback((value: string) => {
    onRenameDraftChangeRef.current(value);
  }, []);

  const handleSubmitRename = useCallback(() => {
    onSubmitRenameRef.current();
  }, []);

  const handleCancelRename = useCallback(() => {
    onCancelRenameRef.current();
  }, []);

  const handleDelete = useCallback((entry: FileEntry) => {
    onDeleteRef.current(entry);
  }, []);

  const handleEditFolderProperties = useCallback((entry: FileEntry) => {
    onEditFolderPropertiesRef.current(entry);
  }, []);

  const contextValue = useMemo(
    () => ({
      activeFilePath,
      selectedPath,
      expandedState,
      isBusy,
      renamingPath,
      renameDraft,
      pendingCreation,
      onSelect: handleSelect,
      onToggleDirectory: handleToggleDirectory,
      onOpenFile: handleOpenFile,
      onCreateFile: handleCreateFile,
      onCreateFolder: handleCreateFolder,
      onPendingNameChange: handlePendingNameChange,
      onSubmitCreate: handleSubmitCreate,
      onCancelCreate: handleCancelCreate,
      onBeginRename: handleBeginRename,
      onRenameDraftChange: handleRenameDraftChange,
      onSubmitRename: handleSubmitRename,
      onCancelRename: handleCancelRename,
      onDelete: handleDelete,
      onEditFolderProperties: handleEditFolderProperties,
    }),
    [
      activeFilePath,
      selectedPath,
      expandedState,
      isBusy,
      renamingPath,
      renameDraft,
      pendingCreation,
      handleSelect,
      handleToggleDirectory,
      handleOpenFile,
      handleCreateFile,
      handleCreateFolder,
      handlePendingNameChange,
      handleSubmitCreate,
      handleCancelCreate,
      handleBeginRename,
      handleRenameDraftChange,
      handleSubmitRename,
      handleCancelRename,
      handleDelete,
      handleEditFolderProperties,
    ],
  );

  return <FileTreeContext.Provider value={contextValue}>{children}</FileTreeContext.Provider>;
}

export function useFileTreeContext() {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error("useFileTreeContext must be used within a FileTreeContextProvider");
  }

  return context;
}

// Uses generated TauRPC types/proxy from src/bindings.ts.
import { createTauRPCProxy } from "~/bindings";
import type {
  EnvironmentData,
  EnvironmentList,
  FileEntry,
  HistoryEntry,
  HistoryFilter,
  HistoryListEntry,
  HttpFileData,
  HttpRequestData,
  HttpResponseData,
} from "~/bindings";

const api = createTauRPCProxy();

export { api };

export const sendRequest = async (
  data: HttpRequestData,
): Promise<HttpResponseData> => {
  return api.send_request(data);
};

export const pickWorkspaceFolder = async (): Promise<string | null> => {
  return api.workspace.pick_workspace_folder();
};

export const listFiles = async (path: string): Promise<FileEntry[]> => {
  return api.workspace.list_files(path);
};

export const ensureWorkspace = async (path: string): Promise<void> => {
  await api.workspace.ensure_workspace(path);
};

export const readHttpFile = async (path: string): Promise<HttpFileData> => {
  return api.workspace.read_http_file(path);
};

export const writeHttpFile = async (
  path: string,
  data: HttpFileData,
): Promise<void> => {
  await api.workspace.write_http_file(path, data);
};

export const createHttpFile = async (
  dirPath: string,
  fileName: string,
): Promise<string> => {
  return api.workspace.create_http_file(dirPath, fileName);
};

export const createDirectory = async (
  parentPath: string,
  dirName: string,
): Promise<string> => {
  return api.workspace.create_directory(parentPath, dirName);
};

export const deletePath = async (path: string): Promise<void> => {
  await api.workspace.delete_path(path);
};

export const renamePath = async (
  fromPath: string,
  toPath: string,
): Promise<void> => {
  await api.workspace.rename_path(fromPath, toPath);
};

export const listEnvironments = async (
  workspacePath: string,
): Promise<EnvironmentList> => {
  return api.environment.list_environments(workspacePath);
};

export const readEnvironment = async (
  workspacePath: string,
  name: string,
): Promise<EnvironmentData> => {
  return api.environment.read_environment(workspacePath, name);
};

export const saveEnvironment = async (
  workspacePath: string,
  environment: EnvironmentData,
): Promise<void> => {
  await api.environment.save_environment(workspacePath, environment);
};

export const deleteEnvironment = async (
  workspacePath: string,
  name: string,
): Promise<void> => {
  await api.environment.delete_environment(workspacePath, name);
};

export const setActiveEnvironment = async (
  workspacePath: string,
  name: string | null,
): Promise<void> => {
  await api.environment.set_active_environment(workspacePath, name);
};

export const resolveUrlPreview = async (
  url: string,
  workspacePath: string,
  envName: string | null,
): Promise<string> => {
  return api.environment.resolve_url_preview(url, workspacePath, envName);
};

export const listHistory = async (
  filter: HistoryFilter,
): Promise<HistoryListEntry[]> => {
  return api.history.list_history(filter);
};

export const getHistoryEntry = async (
  id: number,
): Promise<HistoryEntry | null> => {
  return api.history.get_history_entry(id);
};

export const deleteHistoryEntry = async (id: number): Promise<void> => {
  await api.history.delete_history_entry(id);
};

export const clearHistory = async (): Promise<void> => {
  await api.history.clear_history();
};

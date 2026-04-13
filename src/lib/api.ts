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
  ImportResult,
  PickedFile,
} from "~/bindings";

const api = createTauRPCProxy();

export { api };

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Unexpected API error";
};

const withApiError = async <T>(
  operation: Promise<T>,
  context: string,
): Promise<T> => {
  try {
    return await operation;
  } catch (error) {
    throw new Error(`${context}: ${getErrorMessage(error)}`);
  }
};

export const sendRequest = async (
  data: HttpRequestData,
): Promise<HttpResponseData> => {
  return withApiError(api.send_request(data), "Failed to send request");
};

export const sendRequestWithEnv = async (
  data: HttpRequestData,
  environmentName: string | null,
  workspacePath: string | null,
): Promise<HttpResponseData> => {
  return withApiError(
    api.send_request_with_env(data, environmentName, workspacePath),
    "Failed to send request",
  );
};

export const saveResponseToFile = async (
  bodyBase64: string | null,
  suggestedFilename: string | null,
): Promise<boolean> => {
  return withApiError(
    api.save_response_to_file(bodyBase64, suggestedFilename),
    "Failed to save response",
  );
};

export const exportCurl = async (request: HttpRequestData): Promise<string> => {
  return withApiError(api.import_export.export_curl(request), "Failed to export cURL");
};

export const importCurl = async (
  curlCommand: string,
): Promise<HttpRequestData> => {
  return withApiError(api.import_export.import_curl(curlCommand), "Failed to import cURL");
};

export const importPostmanCollection = async (
  jsonContent: string,
  workspacePath: string,
): Promise<ImportResult> => {
  return withApiError(
    api.import_export.import_postman_collection(jsonContent, workspacePath),
    "Failed to import Postman collection",
  );
};

export const pickImportFile = async (): Promise<string | null> => {
  return withApiError(api.import_export.pick_import_file(), "Failed to pick import file");
};

export const pickWorkspaceFolder = async (): Promise<string | null> => {
  return withApiError(api.workspace.pick_workspace_folder(), "Failed to pick workspace");
};

export const pickFile = async (): Promise<PickedFile | null> => {
  return withApiError(api.workspace.pick_file(), "Failed to pick file");
};

export const listFiles = async (path: string): Promise<FileEntry[]> => {
  return withApiError(api.workspace.list_files(path), "Failed to list files");
};

export const ensureWorkspace = async (path: string): Promise<void> => {
  await withApiError(api.workspace.ensure_workspace(path), "Failed to initialize workspace");
};

export const readHttpFile = async (path: string): Promise<HttpFileData> => {
  return withApiError(api.workspace.read_http_file(path), "Failed to read request file");
};

export const writeHttpFile = async (
  path: string,
  data: HttpFileData,
): Promise<void> => {
  await withApiError(api.workspace.write_http_file(path, data), "Failed to write request file");
};

export const createHttpFile = async (
  dirPath: string,
  fileName: string,
): Promise<string> => {
  return withApiError(
    api.workspace.create_http_file(dirPath, fileName),
    "Failed to create request file",
  );
};

export const createDirectory = async (
  parentPath: string,
  dirName: string,
): Promise<string> => {
  return withApiError(
    api.workspace.create_directory(parentPath, dirName),
    "Failed to create directory",
  );
};

export const deletePath = async (path: string): Promise<void> => {
  await withApiError(api.workspace.delete_path(path), "Failed to delete path");
};

export const renamePath = async (
  fromPath: string,
  toPath: string,
): Promise<void> => {
  await withApiError(api.workspace.rename_path(fromPath, toPath), "Failed to rename path");
};

export const listEnvironments = async (
  workspacePath: string,
): Promise<EnvironmentList> => {
  return withApiError(
    api.environment.list_environments(workspacePath),
    "Failed to list environments",
  );
};

export const readEnvironment = async (
  workspacePath: string,
  name: string,
): Promise<EnvironmentData> => {
  return withApiError(
    api.environment.read_environment(workspacePath, name),
    "Failed to read environment",
  );
};

export const saveEnvironment = async (
  workspacePath: string,
  environment: EnvironmentData,
): Promise<void> => {
  await withApiError(
    api.environment.save_environment(workspacePath, environment),
    "Failed to save environment",
  );
};

export const deleteEnvironment = async (
  workspacePath: string,
  name: string,
): Promise<void> => {
  await withApiError(
    api.environment.delete_environment(workspacePath, name),
    "Failed to delete environment",
  );
};

export const setActiveEnvironment = async (
  workspacePath: string,
  name: string | null,
): Promise<void> => {
  await withApiError(
    api.environment.set_active_environment(workspacePath, name),
    "Failed to switch environment",
  );
};

export const resolveUrlPreview = async (
  url: string,
  workspacePath: string,
  envName: string | null,
): Promise<string> => {
  return withApiError(
    api.environment.resolve_url_preview(url, workspacePath, envName),
    "Failed to resolve URL preview",
  );
};

export const listHistory = async (
  filter: HistoryFilter,
): Promise<HistoryListEntry[]> => {
  return withApiError(api.history.list_history(filter), "Failed to list history");
};

export const getHistoryEntry = async (
  id: number,
): Promise<HistoryEntry | null> => {
  return withApiError(api.history.get_history_entry(id), "Failed to load history entry");
};

export const deleteHistoryEntry = async (id: number): Promise<void> => {
  await withApiError(api.history.delete_history_entry(id), "Failed to delete history entry");
};

export const clearHistory = async (): Promise<void> => {
  await withApiError(api.history.clear_history(), "Failed to clear history");
};

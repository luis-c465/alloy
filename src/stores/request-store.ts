import { create } from "zustand";
import type {
  HttpFileData,
  HttpFileRequest,
  HttpRequestData,
  HttpResponseData,
  KeyValue as ApiKeyValue,
  MultipartField as ApiMultipartField,
  MultipartValue,
  RequestBody,
} from "~/bindings";
import {
  readHttpFile,
  sendRequestWithEnv as sendRequestWithEnvApi,
  writeHttpFile,
} from "~/lib/api";
import {
  DIRTY_TAB_DECISIONS,
  REQUEST_TABS,
  RESPONSE_TABS,
} from "~/lib/constants";
import { useWorkspaceStore } from "~/stores/workspace-store";

export interface KeyValue extends ApiKeyValue {
  id: string;
}

export interface MultipartField extends ApiMultipartField {
  id: string;
  fileSizeBytes: number | null;
}

export type BodyType = "none" | "json" | "form-urlencoded" | "form-data" | "raw";
export type AuthType = "none" | "bearer" | "basic";
export type RequestTab = (typeof REQUEST_TABS)[number];
export type ResponseTab = (typeof RESPONSE_TABS)[number];
export type DirtyTabEvictionMode = "protect" | "prompt";
export type NoClosableTabBehavior = "block" | "skip" | "prompt";

export interface TabLimitSettings {
  enabled: boolean;
  limit: number;
  dirtyTabEvictionMode: DirtyTabEvictionMode;
  whenNoClosableTab: NoClosableTabBehavior;
}

const TAB_LIMIT_SETTINGS_KEY = "alloy-tab-limit-settings";

const DEFAULT_TAB_LIMIT_SETTINGS: TabLimitSettings = {
  enabled: false,
  limit: 10,
  dirtyTabEvictionMode: "protect",
  whenNoClosableTab: "block",
};

export interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  requestIndex: number | null;
  requestName: string | null;
  isDirty: boolean;
  method: string;
  url: string;
  headers: KeyValue[];
  variables: KeyValue[];
  queryParams: KeyValue[];
  bodyType: BodyType;
  bodyContent: string;
  bodyFormData: KeyValue[];
  multipartFields: MultipartField[];
  rawContentType: string;
  authType: AuthType;
  authBearer: string;
  authBasicUsername: string;
  authBasicPassword: string;
  skipSslVerification: boolean;
  timeoutMs: number | null;
  response: HttpResponseData | null;
  isLoading: boolean;
  error: string | null;
  activeRequestTab: RequestTab;
  activeResponseTab: ResponseTab;
  lastInteractedAt: number;
}

interface RequestStore {
  tabs: Tab[];
  activeTabId: string | null;
  tabLimitSettings: TabLimitSettings;
  tabLimitNotice: string | null;
  createTab: (options?: Partial<Tab>) => Promise<string | null>;
  duplicateTab: (id: string) => string | null;
  closeTab: (id: string) => Promise<void>;
  closeOtherTabs: (id: string) => Promise<void>;
  closeTabsToRight: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateActiveTab: (patch: Partial<Tab>) => void;
  setMethod: (method: string) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setVariables: (variables: KeyValue[]) => void;
  setQueryParams: (params: KeyValue[]) => void;
  setBodyType: (type: BodyType) => void;
  setBodyContent: (content: string) => void;
  setBodyFormData: (data: KeyValue[]) => void;
  setMultipartFields: (fields: MultipartField[]) => void;
  setRawContentType: (contentType: string) => void;
  setAuthType: (authType: AuthType) => void;
  setAuthBearer: (authBearer: string) => void;
  setAuthBasicUsername: (authBasicUsername: string) => void;
  setAuthBasicPassword: (authBasicPassword: string) => void;
  setSkipSslVerification: (skipSslVerification: boolean) => void;
  setTimeoutMs: (timeoutMs: number | null) => void;
  setResponse: (response: HttpResponseData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveRequestTab: (tab: RequestTab) => void;
  setActiveResponseTab: (tab: ResponseTab) => void;
  markDirty: () => void;
  markClean: () => void;
  openRequestInTab: (
    request: HttpFileRequest,
    filePath: string,
    requestIndex?: number,
  ) => Promise<string | null>;
  syncQueryParamsToUrl: () => void;
  syncUrlToQueryParams: () => void;
  saveTab: (id: string) => Promise<boolean>;
  saveActiveTab: () => Promise<boolean>;
  saveActiveTabAs: () => Promise<boolean>;
  setTabLimitSettings: (settings: Partial<TabLimitSettings>) => void;
  clearTabLimitNotice: () => void;
  sendRequest: () => Promise<void>;
}

export type DirtyTabDecision = (typeof DIRTY_TAB_DECISIONS)[number];

type DirtyTabPromptHandler = (tab: Tab) => Promise<DirtyTabDecision>;
type SaveAsHandler = (tab: Tab) => Promise<string | null>;
type TabLimitPromptHandler = (tabs: Tab[]) => Promise<string | null>;
type TabLimitOpenInstruction =
  | { kind: "open" }
  | { kind: "deny"; notice: string }
  | { kind: "close"; tabId: string };

let dirtyTabPromptHandler: DirtyTabPromptHandler | null = null;
let saveAsHandler: SaveAsHandler | null = null;
let tabLimitPromptHandler: TabLimitPromptHandler | null = null;

export const registerDirtyTabPromptHandler = (
  handler: DirtyTabPromptHandler,
): (() => void) => {
  dirtyTabPromptHandler = handler;

  return () => {
    if (dirtyTabPromptHandler === handler) {
      dirtyTabPromptHandler = null;
    }
  };
};

export const registerSaveAsHandler = (handler: SaveAsHandler): (() => void) => {
  saveAsHandler = handler;

  return () => {
    if (saveAsHandler === handler) {
      saveAsHandler = null;
    }
  };
};

export const registerTabLimitPromptHandler = (
  handler: TabLimitPromptHandler,
): (() => void) => {
  tabLimitPromptHandler = handler;

  return () => {
    if (tabLimitPromptHandler === handler) {
      tabLimitPromptHandler = null;
    }
  };
};

export const createEmptyKeyValue = (): KeyValue => ({
  key: "",
  value: "",
  enabled: true,
  id: crypto.randomUUID(),
});

const createEmptyMultipartField = (): MultipartField => ({
  key: "",
  value: { Text: "" },
  content_type: null,
  enabled: true,
  id: crypto.randomUUID(),
  fileSizeBytes: null,
});

const TAB_LIMIT_STORAGE_MIN = 1;
const TAB_LIMIT_STORAGE_MAX = 100;

const isBrowser = (): boolean => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const clampTabLimit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_TAB_LIMIT_SETTINGS.limit;
  }

  const rounded = Math.trunc(value);
  if (rounded <= 0) {
    return TAB_LIMIT_STORAGE_MIN;
  }

  if (rounded > TAB_LIMIT_STORAGE_MAX) {
    return TAB_LIMIT_STORAGE_MAX;
  }

  if (rounded < TAB_LIMIT_STORAGE_MIN) {
    return TAB_LIMIT_STORAGE_MIN;
  }

  return rounded;
};

const isDirtyTabEvictionMode = (value: unknown): value is DirtyTabEvictionMode => (
  value === "protect" || value === "prompt"
);

const isNoClosableTabBehavior = (value: unknown): value is NoClosableTabBehavior => (
  value === "block" || value === "skip" || value === "prompt"
);

const normalizeTabLimitSettings = (settings: Partial<TabLimitSettings>): TabLimitSettings => ({
  enabled: settings.enabled ?? DEFAULT_TAB_LIMIT_SETTINGS.enabled,
  limit: clampTabLimit(settings.limit ?? DEFAULT_TAB_LIMIT_SETTINGS.limit),
  dirtyTabEvictionMode: isDirtyTabEvictionMode(settings.dirtyTabEvictionMode)
    ? settings.dirtyTabEvictionMode
    : DEFAULT_TAB_LIMIT_SETTINGS.dirtyTabEvictionMode,
  whenNoClosableTab: isNoClosableTabBehavior(settings.whenNoClosableTab)
    ? settings.whenNoClosableTab
    : DEFAULT_TAB_LIMIT_SETTINGS.whenNoClosableTab,
});

const buildTabLimitNotice = (limit: number): string => (
  `Tab limit reached (${limit}). Close a tab before opening another request.`
);

const readTabLimitSettingsFromStorage = (): TabLimitSettings => {
  if (!isBrowser()) {
    return DEFAULT_TAB_LIMIT_SETTINGS;
  }

  try {
    const storedValue = window.localStorage.getItem(TAB_LIMIT_SETTINGS_KEY);
    if (!storedValue) {
      return DEFAULT_TAB_LIMIT_SETTINGS;
    }

    const parsed = JSON.parse(storedValue) as Record<string, unknown>;

    const dirtyTabEvictionMode = isDirtyTabEvictionMode(parsed.dirtyTabEvictionMode)
      ? parsed.dirtyTabEvictionMode
      : undefined;

    const whenNoClosableTab = isNoClosableTabBehavior(parsed.whenNoClosableTab)
      ? parsed.whenNoClosableTab
      : undefined;

    return normalizeTabLimitSettings({
      enabled: parsed.enabled === true ? true : parsed.enabled === false ? false : undefined,
      limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
      dirtyTabEvictionMode,
      whenNoClosableTab,
    });
  } catch {
    return DEFAULT_TAB_LIMIT_SETTINGS;
  }
};

const saveTabLimitSettingsToStorage = (settings: TabLimitSettings): void => {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(TAB_LIMIT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Persisting settings is best-effort and should not break tab flow.
  }
};

const getTabLimitCandidates = (tabs: Tab[], activeTabId: string | null): Tab[] => {
  return tabs
    .filter((tab) => tab.id !== activeTabId)
    .filter((tab) => !tab.isLoading)
    .filter((tab) => !tab.isDirty)
    .sort((a, b) => a.lastInteractedAt - b.lastInteractedAt);
};

const getTabLimitPromptCandidates = (
  tabs: Tab[],
  activeTabId: string | null,
  dirtyTabEvictionMode: DirtyTabEvictionMode,
): Tab[] => {
  const validTabs = tabs.filter((tab) => tab.id !== activeTabId && !tab.isLoading);

  if (dirtyTabEvictionMode === "protect") {
    return validTabs.filter((tab) => !tab.isDirty);
  }

  return validTabs;
};

const maybeEnforceTabLimitBeforeOpen = async (
  tabs: Tab[],
  activeTabId: string | null,
  settings: TabLimitSettings,
): Promise<TabLimitOpenInstruction> => {
  if (!settings.enabled || tabs.length < settings.limit) {
    return { kind: "open" };
  }

  const evictionCandidates = getTabLimitCandidates(tabs, activeTabId);
  if (evictionCandidates.length > 0) {
    return { kind: "close", tabId: evictionCandidates[0]!.id };
  }

  if (settings.whenNoClosableTab === "skip") {
    return { kind: "open" };
  }

  if (settings.whenNoClosableTab === "block") {
    return { kind: "deny", notice: buildTabLimitNotice(settings.limit) };
  }

  const promptCandidates = getTabLimitPromptCandidates(
    tabs,
    activeTabId,
    settings.dirtyTabEvictionMode,
  );

  if (!tabLimitPromptHandler) {
    return { kind: "deny", notice: buildTabLimitNotice(settings.limit) };
  }

  const selectedTabId = await tabLimitPromptHandler(promptCandidates);
  if (!selectedTabId) {
    return { kind: "deny", notice: buildTabLimitNotice(settings.limit) };
  }

  const matchingTab = promptCandidates.some((tab) => tab.id === selectedTabId);
  if (!matchingTab) {
    return { kind: "deny", notice: buildTabLimitNotice(settings.limit) };
  }

  return { kind: "close", tabId: selectedTabId };
};

const toApiKeyValue = ({ key, value, enabled }: KeyValue): ApiKeyValue => ({
  key,
  value,
  enabled,
});

export const encodeBase64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const getEnvironmentVariableMap = (
  variables: ApiKeyValue[],
): Map<string, string> => {
  const entries = variables
    .filter((variable) => variable.enabled && variable.key.trim().length > 0)
    .map((variable) => [variable.key.trim(), variable.value] as const);

  return new Map(entries);
};

export const resolveTemplateString = (
  value: string,
  variables: Map<string, string>,
): string => {
  if (!value.includes("{{")) {
    return value;
  }

  return value.replace(TEMPLATE_VARIABLE_PATTERN, (_match, name: string) => {
    const variableName = name.trim();
    return variables.get(variableName) ?? `{{${variableName}}}`;
  });
};

const getActiveEnvironmentVariableMap = (): Map<string, string> => {
  const { activeEnvironment, environments } = useWorkspaceStore.getState();
  const activeVariables = environments.find(
    (environment) => environment.name === activeEnvironment,
  )?.variables;

  return getEnvironmentVariableMap(activeVariables ?? []);
};

export const getAuthorizationHeaderValue = (
  authType: AuthType,
  authBearer: string,
  authBasicUsername: string,
  authBasicPassword: string,
): string | null => {
  if (authType === "bearer") {
    const token = authBearer.trim();
    return token ? `Bearer ${token}` : null;
  }

  if (authType === "basic") {
    return `Basic ${encodeBase64Utf8(`${authBasicUsername}:${authBasicPassword}`)}`;
  }

  return null;
};

const toApiMultipartField = ({
  key,
  value,
  content_type,
  enabled,
}: MultipartField): ApiMultipartField => ({
  key,
  value,
  content_type,
  enabled,
});

const isMultipartTextValue = (
  value: MultipartValue,
): value is Extract<MultipartValue, { Text: string }> => "Text" in value;

const isMultipartFileValue = (
  value: MultipartValue,
): value is Extract<MultipartValue, { File: { path: string; filename: string | null } }> =>
  "File" in value;

const isEmptyMultipartField = (field: MultipartField): boolean => {
  if (!field.key.trim()) {
    if (isMultipartTextValue(field.value)) {
      return !field.value.Text.trim();
    }

    if (isMultipartFileValue(field.value)) {
      return !field.value.File.path.trim();
    }
  }

  return false;
};

const fromApiKeyValue = ({ key, value, enabled }: ApiKeyValue): KeyValue => ({
  key,
  value,
  enabled,
  id: crypto.randomUUID(),
});

const toRequestBody = (
  bodyType: BodyType,
  bodyContent: string,
  bodyFormData: KeyValue[],
  multipartFields: MultipartField[],
  rawContentType: string,
): RequestBody => {
  switch (bodyType) {
    case "json":
      return { Json: bodyContent };
    case "form-urlencoded":
      return {
        FormUrlEncoded: bodyFormData
          .filter((item) => item.enabled)
          .map(toApiKeyValue),
      };
    case "form-data":
      return {
        Multipart: multipartFields
          .filter((field) => field.enabled && !isEmptyMultipartField(field))
          .map(toApiMultipartField),
      };
    case "raw":
      return {
        Raw: {
          content: bodyContent,
          content_type: rawContentType,
        },
      };
    case "none":
    default:
      return "None";
  }
};

const toHttpFileBody = (tab: Tab): string | null => {
  switch (tab.bodyType) {
    case "json":
    case "raw":
      return tab.bodyContent.trim() ? tab.bodyContent : null;
    case "form-urlencoded": {
      const params = new URLSearchParams();

      for (const item of tab.bodyFormData) {
        if (!item.enabled || !item.key.trim()) {
          continue;
        }

        params.append(item.key, item.value);
      }

      const serialized = params.toString();
      return serialized.length > 0 ? serialized : null;
    }
    case "form-data":
    case "none":
    default:
      return null;
  }
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Failed to send request";
};

const normalizeTimeoutMs = (timeoutMs: number | null): number | null => {
  if (timeoutMs === null) {
    return null;
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    return null;
  }

  return timeoutMs;
};

const getRequestHeaders = (
  tab: Tab,
  environmentVariables: Map<string, string> = new Map(),
): ApiKeyValue[] => {
  const filteredHeaders = tab.headers.filter((header) => {
    if (!header.enabled) {
      return false;
    }

    if (tab.authType !== "none" && header.key.trim().toLowerCase() === "authorization") {
      return false;
    }

    return true;
  });

  const authHeaderValue = getAuthorizationHeaderValue(
    tab.authType,
    resolveTemplateString(tab.authBearer, environmentVariables),
    resolveTemplateString(tab.authBasicUsername, environmentVariables),
    resolveTemplateString(tab.authBasicPassword, environmentVariables),
  );

  if (!authHeaderValue) {
    return filteredHeaders.map(toApiKeyValue);
  }

  return [
    ...filteredHeaders.map(toApiKeyValue),
    {
      key: "Authorization",
      value: authHeaderValue,
      enabled: true,
    },
  ];
};

const getBaseUrl = (url: string): string => {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
};

const parseQueryParamsFromUrl = (url: string): KeyValue[] => {
  if (!url.trim()) {
    return [];
  }

  try {
    const parsedUrl = new URL(url);
    const params: KeyValue[] = [];

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      params.push({
        key,
        value,
        enabled: true,
        id: crypto.randomUUID(),
      });
    }

    return params;
  } catch {
    return [];
  }
};

const getFileTabName = (filePath: string, requestIndex: number): string => {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return requestIndex > 0 ? `${fileName} #${requestIndex + 1}` : fileName;
};

const createDefaultTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: crypto.randomUUID(),
  name: "New Request",
  filePath: null,
  requestIndex: null,
  requestName: null,
  isDirty: false,
  method: "GET",
  url: "",
  headers: [createEmptyKeyValue()],
  variables: [createEmptyKeyValue()],
  queryParams: [],
  bodyType: "none",
  bodyContent: "",
  bodyFormData: [],
  multipartFields: [],
  rawContentType: "text/plain",
  authType: "none",
  authBearer: "",
  authBasicUsername: "",
  authBasicPassword: "",
  skipSslVerification: false,
  timeoutMs: null,
  response: null,
  isLoading: false,
  error: null,
  activeRequestTab: "params",
  activeResponseTab: "body",
  lastInteractedAt: Date.now(),
  ...overrides,
});

const cloneKeyValue = ({ key, value, enabled }: KeyValue): KeyValue => ({
  key,
  value,
  enabled,
  id: crypto.randomUUID(),
});

const cloneMultipartField = (field: MultipartField): MultipartField => ({
  ...field,
  value: structuredClone(field.value),
  id: crypto.randomUUID(),
});

const duplicateTabData = (tab: Tab): Tab => createDefaultTab({
  name: tab.name,
  filePath: null,
  requestIndex: null,
  requestName: null,
  isDirty: true,
  method: tab.method,
  url: tab.url,
  headers: tab.headers.map(cloneKeyValue),
  variables: tab.variables.map(cloneKeyValue),
  queryParams: tab.queryParams.map(cloneKeyValue),
  bodyType: tab.bodyType,
  bodyContent: tab.bodyContent,
  bodyFormData: tab.bodyFormData.map(cloneKeyValue),
  multipartFields: tab.multipartFields.map(cloneMultipartField),
  rawContentType: tab.rawContentType,
  authType: tab.authType,
  authBearer: tab.authBearer,
  authBasicUsername: tab.authBasicUsername,
  authBasicPassword: tab.authBasicPassword,
  skipSslVerification: tab.skipSslVerification,
  timeoutMs: tab.timeoutMs,
  response: null,
  isLoading: false,
  error: null,
  activeRequestTab: tab.activeRequestTab,
  activeResponseTab: tab.activeResponseTab,
});

const normalizeBodyType = (value: string): BodyType => {
  if (
    value === "json" ||
    value === "form-urlencoded" ||
    value === "form-data" ||
    value === "raw"
  ) {
    return value;
  }

  return "none";
};

const parseFormDataBody = (body: string | null): KeyValue[] => {
  if (!body?.trim()) {
    return [createEmptyKeyValue()];
  }

  const params = new URLSearchParams(body);
  const entries: KeyValue[] = [];

  for (const [key, value] of params.entries()) {
    entries.push({
      key,
      value,
      enabled: true,
      id: crypto.randomUUID(),
    });
  }

  return entries.length > 0 ? entries : [createEmptyKeyValue()];
};

const touchTabById = (tabs: Tab[], tabId: string, now = Date.now()): Tab[] => (
  tabs.map((tab) => (tab.id === tabId ? { ...tab, lastInteractedAt: now } : tab))
);

const touchActiveTab = (state: { tabs: Tab[]; activeTabId: string | null }): Tab[] => {
  if (!state.activeTabId) {
    return state.tabs;
  }

  return touchTabById(state.tabs, state.activeTabId);
};

const withInteraction = (patch: Partial<Tab>): Partial<Tab> => ({
  ...patch,
  lastInteractedAt: Date.now(),
});

const latestRequestTokenByTab = new Map<string, number>();

const getNextRequestToken = (tabId: string): number => {
  const nextToken = (latestRequestTokenByTab.get(tabId) ?? 0) + 1;
  latestRequestTokenByTab.set(tabId, nextToken);
  return nextToken;
};

const updateTabById = (
  tabs: Tab[],
  tabId: string,
  patch: Partial<Tab>,
): Tab[] => tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));

const getTargetTabId = (tabs: Tab[], activeTabId: string | null): string | null => (
  activeTabId ?? tabs[0]?.id ?? null
);

const removeTabById = (tabs: Tab[], tabId: string): Tab[] => (
  tabs.filter((tab) => tab.id !== tabId)
);

const performCloseTab = (tabs: Tab[], activeTabId: string | null, tabId: string) => {
  if (tabs.length <= 1) {
    const tab = createDefaultTab();
    return {
      tabs: [tab],
      activeTabId: tab.id,
    };
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex === -1) {
    return {
      tabs,
      activeTabId,
    };
  }

  const nextTabs = removeTabById(tabs, tabId);
  latestRequestTokenByTab.delete(tabId);

  if (activeTabId !== tabId) {
    return { tabs: nextTabs, activeTabId };
  }

  const nextActiveTab = nextTabs[currentIndex] ?? nextTabs[currentIndex - 1] ?? null;
  return {
    tabs: nextTabs,
    activeTabId: nextActiveTab?.id ?? null,
  };
};

const toHttpFileRequest = (
  tab: Tab,
  commands: Array<[string, string | null]> = [],
): HttpFileRequest => ({
  name: tab.requestName?.trim() || null,
  method: tab.method || "GET",
  url: tab.url,
  headers: tab.headers
    .filter((header) => header.enabled && header.key.trim().length > 0)
    .map(toApiKeyValue),
  variables: tab.variables
    .filter((variable) => variable.enabled && variable.key.trim().length > 0)
    .map(toApiKeyValue),
  body: toHttpFileBody(tab),
  body_type: tab.bodyType,
  commands,
});

const buildExistingFileSavePayload = async (
  tab: Tab,
  openTabs: Tab[],
): Promise<HttpFileData> => {
  if (!tab.filePath) {
    throw new Error("Cannot save tab without a file path");
  }

  const currentFile = await readHttpFile(tab.filePath);
  const tabsByIndex = new Map<number, Tab>();

  for (const openTab of openTabs) {
    if (openTab.requestIndex === null) {
      continue;
    }

    tabsByIndex.set(openTab.requestIndex, openTab);
  }

  const requests = currentFile.requests.map((request, index) => {
    const openTab = tabsByIndex.get(index);
    if (!openTab) {
      return request;
    }

    return toHttpFileRequest(openTab, request.commands);
  });

  return {
    path: currentFile.path,
    variables: currentFile.variables,
    requests,
  };
};

const buildSingleRequestSavePayload = (tab: Tab, filePath: string): HttpFileData => ({
  path: filePath,
  variables: [],
  requests: [toHttpFileRequest(tab)],
});

const saveTabById = async (
  tabId: string,
  getStore: () => RequestStore,
  setStore: (
    partial:
      | Partial<RequestStore>
      | ((state: RequestStore) => Partial<RequestStore>),
  ) => void,
  forceSaveAs = false,
): Promise<boolean> => {
  const state = getStore();
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    return false;
  }

  const selectedPath = forceSaveAs || !tab.filePath
    ? await saveAsHandler?.(tab) ?? null
    : tab.filePath;

  if (!selectedPath) {
    return false;
  }

  const shouldPreserveExistingFile = !forceSaveAs && tab.filePath === selectedPath;
  const payload = shouldPreserveExistingFile
    ? await buildExistingFileSavePayload(
        tab,
        state.tabs.filter((item) => item.filePath === tab.filePath),
      )
    : buildSingleRequestSavePayload(tab, selectedPath);

  await writeHttpFile(selectedPath, payload);

  setStore((currentState) => ({
    tabs: currentState.tabs.map((item) => {
      if (shouldPreserveExistingFile && item.filePath === selectedPath) {
        return { ...item, isDirty: false };
      }

      if (item.id === tabId) {
        return {
          ...item,
          filePath: selectedPath,
          requestIndex: 0,
          isDirty: false,
        };
      }

      return item;
    }),
  }));

  const { workspacePath, refreshFileTree } = useWorkspaceStore.getState();
  if (workspacePath && selectedPath.startsWith(workspacePath)) {
    await refreshFileTree();
  }

  return true;
};

const initialTab = createDefaultTab();

const initialTabLimitSettings = readTabLimitSettingsFromStorage();

export const useRequestStore = create<RequestStore>()((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  tabLimitSettings: initialTabLimitSettings,
  tabLimitNotice: null,
  createTab: async (options) => {
    const state = get();
    const decision = await maybeEnforceTabLimitBeforeOpen(
      state.tabs,
      state.activeTabId,
      state.tabLimitSettings,
    );

    if (decision.kind === "deny") {
      set({ tabLimitNotice: decision.notice });
      return null;
    }

    if (decision.kind === "close") {
      await get().closeTab(decision.tabId);
      if (get().tabs.some((tab) => tab.id === decision.tabId)) {
        set({ tabLimitNotice: buildTabLimitNotice(state.tabLimitSettings.limit) });
        return null;
      }
    }

    const tab = createDefaultTab(options);
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      tabLimitNotice: null,
    }));
    return tab.id;
  },
  duplicateTab: (id) => {
    const sourceTab = get().tabs.find((item) => item.id === id);
    if (!sourceTab) {
      return null;
    }

    const duplicatedTab = duplicateTabData(sourceTab);

    set((state) => {
      const sourceIndex = state.tabs.findIndex((item) => item.id === id);
      if (sourceIndex === -1) {
        return state;
      }

      const nextTabs = [...state.tabs];
      nextTabs.splice(sourceIndex + 1, 0, duplicatedTab);

      return {
        tabs: nextTabs,
        activeTabId: duplicatedTab.id,
      };
    });

    return duplicatedTab.id;
  },
  closeTab: async (id) => {
    const tab = get().tabs.find((item) => item.id === id);
    if (!tab) {
      return;
    }

    if (tab.isDirty) {
      const decision = dirtyTabPromptHandler
        ? await dirtyTabPromptHandler(tab)
        : "cancel";

      if (decision === "cancel") {
        return;
      }

      if (decision === "save") {
        const saved = await saveTabById(id, get, set);
        if (!saved) {
          return;
        }
      }
    }

    set((state) => performCloseTab(state.tabs, state.activeTabId, id));
  },
  closeOtherTabs: async (id) => {
    const tabIdsToClose = get()
      .tabs
      .filter((tab) => tab.id !== id)
      .map((tab) => tab.id);

    for (const tabId of tabIdsToClose) {
      await get().closeTab(tabId);

      if (get().tabs.some((tab) => tab.id === tabId)) {
        return;
      }
    }

    if (get().tabs.some((tab) => tab.id === id)) {
      get().setActiveTab(id);
    }
  },
  closeTabsToRight: async (id) => {
    const { tabs } = get();
    const sourceIndex = tabs.findIndex((tab) => tab.id === id);
    if (sourceIndex === -1) {
      return;
    }

    const tabIdsToClose = tabs.slice(sourceIndex + 1).map((tab) => tab.id);

    for (const tabId of tabIdsToClose) {
      await get().closeTab(tabId);

      if (get().tabs.some((tab) => tab.id === tabId)) {
        return;
      }
    }
  },
  setActiveTab: (id) => {
    set((state) => {
      if (!state.tabs.some((tab) => tab.id === id)) {
        return state;
      }

      return {
        activeTabId: id,
        tabs: touchActiveTab({ tabs: state.tabs, activeTabId: id }),
      };
    });
  },
  updateActiveTab: (patch) => {
    set((state) => {
      const activeTabId = getTargetTabId(state.tabs, state.activeTabId);
      if (!activeTabId) {
        return state;
      }

      return {
        activeTabId,
        tabs: updateTabById(state.tabs, activeTabId, patch),
      };
    });
  },
  setMethod: (method) => get().updateActiveTab(withInteraction({ method, isDirty: true })),
  setUrl: (url) => get().updateActiveTab(withInteraction({ url, isDirty: true })),
  setHeaders: (headers) => get().updateActiveTab(withInteraction({ headers, isDirty: true })),
  setVariables: (variables) => get().updateActiveTab(withInteraction({ variables, isDirty: true })),
  setQueryParams: (queryParams) =>
    get().updateActiveTab(withInteraction({ queryParams, isDirty: true })),
  setBodyType: (bodyType) => get().updateActiveTab(withInteraction({ bodyType, isDirty: true })),
  setBodyContent: (bodyContent) =>
    get().updateActiveTab(withInteraction({ bodyContent, isDirty: true })),
  setBodyFormData: (bodyFormData) =>
    get().updateActiveTab(withInteraction({ bodyFormData, isDirty: true })),
  setMultipartFields: (multipartFields) =>
    get().updateActiveTab(withInteraction({ multipartFields, isDirty: true })),
  setRawContentType: (rawContentType) =>
    get().updateActiveTab(withInteraction({ rawContentType, isDirty: true })),
  setAuthType: (authType) => get().updateActiveTab(withInteraction({ authType, isDirty: true })),
  setAuthBearer: (authBearer) => get().updateActiveTab(withInteraction({ authBearer, isDirty: true })),
  setAuthBasicUsername: (authBasicUsername) =>
    get().updateActiveTab(withInteraction({ authBasicUsername, isDirty: true })),
  setAuthBasicPassword: (authBasicPassword) =>
    get().updateActiveTab(withInteraction({ authBasicPassword, isDirty: true })),
  setSkipSslVerification: (skipSslVerification) =>
    get().updateActiveTab(withInteraction({ skipSslVerification, isDirty: true })),
  setTimeoutMs: (timeoutMs) =>
    get().updateActiveTab(withInteraction({ timeoutMs: normalizeTimeoutMs(timeoutMs), isDirty: true })),
  setResponse: (response) => get().updateActiveTab({ response }),
  setLoading: (isLoading) => get().updateActiveTab({ isLoading }),
  setError: (error) => get().updateActiveTab({ error }),
  setActiveRequestTab: (activeRequestTab) => get().updateActiveTab({ activeRequestTab }),
  setActiveResponseTab: (activeResponseTab) =>
    get().updateActiveTab({ activeResponseTab }),
  markDirty: () => get().updateActiveTab(withInteraction({ isDirty: true })),
  markClean: () => get().updateActiveTab({ isDirty: false }),
  openRequestInTab: async (request, filePath, requestIndex = 0) => {
    const state = get();
    const decision = await maybeEnforceTabLimitBeforeOpen(
      state.tabs,
      state.activeTabId,
      state.tabLimitSettings,
    );

    if (decision.kind === "deny") {
      set({ tabLimitNotice: decision.notice });
      return null;
    }

    if (decision.kind === "close") {
      await get().closeTab(decision.tabId);
      if (get().tabs.some((tab) => tab.id === decision.tabId)) {
        set({ tabLimitNotice: buildTabLimitNotice(state.tabLimitSettings.limit) });
        return null;
      }
    }

    const normalizedBodyType = normalizeBodyType(request.body_type);
    const requestName = request.name?.trim() || null;
    const tabName = requestName || getFileTabName(filePath, requestIndex);
    const tab = createDefaultTab({
      name: tabName,
      filePath,
      requestIndex,
      requestName,
      isDirty: false,
      method: request.method || "GET",
      url: request.url,
      headers: request.headers.map(fromApiKeyValue),
      variables: request.variables.map(fromApiKeyValue),
      queryParams: parseQueryParamsFromUrl(request.url),
      bodyType: normalizedBodyType,
      bodyContent: request.body ?? "",
      bodyFormData:
        normalizedBodyType === "form-urlencoded"
          ? parseFormDataBody(request.body)
          : [createEmptyKeyValue()],
      multipartFields:
        normalizedBodyType === "form-data" ? [createEmptyMultipartField()] : [],
      rawContentType:
        normalizedBodyType === "json" ? "application/json" : "text/plain",
      skipSslVerification: false,
      timeoutMs: null,
      response: null,
      isLoading: false,
      error: null,
      activeRequestTab: "params",
      activeResponseTab: "body",
    });

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      tabLimitNotice: null,
    }));

    return tab.id;
  },
  setTabLimitSettings: (settings) => {
    set((state) => {
      const nextSettings = normalizeTabLimitSettings({
        ...state.tabLimitSettings,
        ...settings,
      });

      saveTabLimitSettingsToStorage(nextSettings);

      return {
        tabLimitSettings: nextSettings,
        tabLimitNotice: null,
      };
    });
  },
  clearTabLimitNotice: () => {
    set({ tabLimitNotice: null });
  },
  syncQueryParamsToUrl: () => {
    const { tabs, activeTabId } = get();
    const targetTabId = getTargetTabId(tabs, activeTabId);
    if (!targetTabId) {
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === targetTabId);
    if (!activeTab) {
      return;
    }

    const { url, queryParams } = activeTab;

    if (!url.trim()) {
      return;
    }

    try {
      const parsedUrl = new URL(url);
      parsedUrl.search = "";

      for (const param of queryParams) {
        if (!param.enabled || !param.key.trim()) {
          continue;
        }

        parsedUrl.searchParams.append(param.key, param.value);
      }

      set((state) => ({
        tabs: updateTabById(state.tabs, targetTabId, withInteraction({
          url: parsedUrl.toString(),
          isDirty: true,
        })),
      }));
    } catch {
      // Ignore malformed URLs while the user is typing.
    }
  },
  syncUrlToQueryParams: () => {
    const { tabs, activeTabId } = get();
    const targetTabId = getTargetTabId(tabs, activeTabId);
    if (!targetTabId) {
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === targetTabId);
    if (!activeTab) {
      return;
    }

    const { url } = activeTab;

    if (!url.trim()) {
      set((state) => ({
        tabs: updateTabById(state.tabs, targetTabId, withInteraction({
          queryParams: [],
          isDirty: true,
        })),
      }));
      return;
    }

    try {
      const parsedUrl = new URL(url);
      const params: KeyValue[] = [];

      for (const [key, value] of parsedUrl.searchParams.entries()) {
        params.push({
          key,
          value,
          enabled: true,
          id: crypto.randomUUID(),
        });
      }

      set((state) => ({
        tabs: updateTabById(state.tabs, targetTabId, withInteraction({
          queryParams: params,
          isDirty: true,
        })),
      }));
    } catch {
      // Ignore malformed URLs while the user is typing.
    }
  },
  saveTab: async (id) => saveTabById(id, get, set),
  saveActiveTab: async () => {
    const activeTabId = get().activeTabId;
    if (!activeTabId) {
      return false;
    }

    return saveTabById(activeTabId, get, set);
  },
  saveActiveTabAs: async () => {
    const activeTabId = get().activeTabId;
    if (!activeTabId) {
      return false;
    }

    return saveTabById(activeTabId, get, set, true);
  },
  sendRequest: async () => {
    const { tabs, activeTabId } = get();
    const targetTabId = getTargetTabId(tabs, activeTabId);
    if (!targetTabId) {
      return;
    }

    const tab = tabs.find((item) => item.id === targetTabId);
    if (!tab) {
      return;
    }

    set((state) => ({
      tabs: touchTabById(state.tabs, targetTabId, Date.now()),
    }));

    const environmentVariables = getActiveEnvironmentVariableMap();
    const requestVariables = getEnvironmentVariableMap(tab.variables);
    const resolvedVariables = new Map([...environmentVariables, ...requestVariables]);

    const payload: HttpRequestData = {
      method: tab.method,
      url: getBaseUrl(tab.url),
      headers: getRequestHeaders(tab, resolvedVariables),
      query_params: tab.queryParams
        .filter((param) => param.enabled)
        .map(toApiKeyValue),
      body: toRequestBody(
        tab.bodyType,
        tab.bodyContent,
        tab.bodyFormData,
        tab.multipartFields,
        tab.rawContentType,
      ),
      timeout_ms: tab.timeoutMs,
      skip_ssl_verification: tab.skipSslVerification,
      request_variables: tab.variables
        .filter((variable) => variable.enabled && variable.key.trim().length > 0)
        .map(toApiKeyValue),
    };

    const requestToken = getNextRequestToken(targetTabId);

    set((state) => ({
      tabs: updateTabById(state.tabs, targetTabId, {
        isLoading: true,
        error: null,
      }),
    }));

    try {
      const { activeEnvironment, workspacePath } = useWorkspaceStore.getState();
      // Only resolve with environment if both values are present; if either is
      // null, skip environment resolution to avoid a backend error.
      const envName = activeEnvironment && workspacePath ? activeEnvironment : null;
      const wsPath = activeEnvironment && workspacePath ? workspacePath : null;
      const response = await sendRequestWithEnvApi(
        payload,
        envName,
        wsPath,
      );
      if (requestToken === latestRequestTokenByTab.get(targetTabId)) {
        set((state) => ({
          tabs: updateTabById(state.tabs, targetTabId, { response }),
        }));
      }
    } catch (error) {
      if (requestToken === latestRequestTokenByTab.get(targetTabId)) {
        set((state) => ({
          tabs: updateTabById(state.tabs, targetTabId, {
            error: getErrorMessage(error),
          }),
        }));
      }
    } finally {
      if (requestToken === latestRequestTokenByTab.get(targetTabId)) {
        set((state) => ({
          tabs: updateTabById(state.tabs, targetTabId, {
            isLoading: false,
          }),
        }));
      }
    }
  },
}));

import { create } from "zustand";
import type {
  HttpFileData,
  HttpFileRequest,
  HttpRequestData,
  HttpResponseData,
  KeyValue as ApiKeyValue,
  RequestBody,
} from "~/bindings";
import {
  readHttpFile,
  sendRequestWithEnv as sendRequestWithEnvApi,
  writeHttpFile,
} from "~/lib/api";
import { useWorkspaceStore } from "~/stores/workspace-store";

export interface KeyValue extends ApiKeyValue {
  id: string;
}

export type BodyType = "none" | "json" | "form-urlencoded" | "raw";
export type RequestTab = "params" | "headers" | "body";
export type ResponseTab = "body" | "headers";

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
  queryParams: KeyValue[];
  bodyType: BodyType;
  bodyContent: string;
  bodyFormData: KeyValue[];
  rawContentType: string;
  response: HttpResponseData | null;
  isLoading: boolean;
  error: string | null;
  activeRequestTab: RequestTab;
  activeResponseTab: ResponseTab;
}

interface RequestStore {
  tabs: Tab[];
  activeTabId: string | null;
  createTab: (options?: Partial<Tab>) => string;
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateActiveTab: (patch: Partial<Tab>) => void;
  setMethod: (method: string) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setQueryParams: (params: KeyValue[]) => void;
  setBodyType: (type: BodyType) => void;
  setBodyContent: (content: string) => void;
  setBodyFormData: (data: KeyValue[]) => void;
  setRawContentType: (contentType: string) => void;
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
  ) => string;
  syncQueryParamsToUrl: () => void;
  syncUrlToQueryParams: () => void;
  saveTab: (id: string) => Promise<boolean>;
  saveActiveTab: () => Promise<boolean>;
  saveActiveTabAs: () => Promise<boolean>;
  sendRequest: () => Promise<void>;
}

export type DirtyTabDecision = "save" | "discard" | "cancel";

type DirtyTabPromptHandler = (tab: Tab) => Promise<DirtyTabDecision>;
type SaveAsHandler = (tab: Tab) => Promise<string | null>;

let dirtyTabPromptHandler: DirtyTabPromptHandler | null = null;
let saveAsHandler: SaveAsHandler | null = null;

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

const createEmptyKeyValue = (): KeyValue => ({
  key: "",
  value: "",
  enabled: true,
  id: crypto.randomUUID(),
});

const toApiKeyValue = ({ key, value, enabled }: KeyValue): ApiKeyValue => ({
  key,
  value,
  enabled,
});

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

const getBaseUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.search = "";
    return parsedUrl.toString();
  } catch {
    return url;
  }
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
  queryParams: [],
  bodyType: "none",
  bodyContent: "",
  bodyFormData: [],
  rawContentType: "text/plain",
  response: null,
  isLoading: false,
  error: null,
  activeRequestTab: "params",
  activeResponseTab: "body",
  ...overrides,
});

const normalizeBodyType = (value: string): BodyType => {
  if (value === "json" || value === "form-urlencoded" || value === "raw") {
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
  body: toHttpFileBody(tab),
  body_type: tab.bodyType,
  commands,
});

const buildExistingFileSavePayload = async (
  tab: Tab,
  openTabs: Tab[],
): Promise<HttpFileData> => {
  const currentFile = await readHttpFile(tab.filePath!);
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

export const useRequestStore = create<RequestStore>()((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  createTab: (options) => {
    const tab = createDefaultTab(options);
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
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
  setActiveTab: (id) => {
    set((state) => {
      if (!state.tabs.some((tab) => tab.id === id)) {
        return state;
      }

      return { activeTabId: id };
    });
  },
  updateActiveTab: (patch) => {
    set((state) => {
      const activeTabId = state.activeTabId ?? state.tabs[0]?.id ?? null;
      if (!activeTabId) {
        return state;
      }

      return {
        activeTabId,
        tabs: updateTabById(state.tabs, activeTabId, patch),
      };
    });
  },
  setMethod: (method) => get().updateActiveTab({ method, isDirty: true }),
  setUrl: (url) => get().updateActiveTab({ url, isDirty: true }),
  setHeaders: (headers) => get().updateActiveTab({ headers, isDirty: true }),
  setQueryParams: (queryParams) =>
    get().updateActiveTab({ queryParams, isDirty: true }),
  setBodyType: (bodyType) => get().updateActiveTab({ bodyType, isDirty: true }),
  setBodyContent: (bodyContent) =>
    get().updateActiveTab({ bodyContent, isDirty: true }),
  setBodyFormData: (bodyFormData) =>
    get().updateActiveTab({ bodyFormData, isDirty: true }),
  setRawContentType: (rawContentType) =>
    get().updateActiveTab({ rawContentType, isDirty: true }),
  setResponse: (response) => get().updateActiveTab({ response }),
  setLoading: (isLoading) => get().updateActiveTab({ isLoading }),
  setError: (error) => get().updateActiveTab({ error }),
  setActiveRequestTab: (activeRequestTab) => get().updateActiveTab({ activeRequestTab }),
  setActiveResponseTab: (activeResponseTab) =>
    get().updateActiveTab({ activeResponseTab }),
  markDirty: () => get().updateActiveTab({ isDirty: true }),
  markClean: () => get().updateActiveTab({ isDirty: false }),
  openRequestInTab: (request, filePath, requestIndex = 0) => {
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
      queryParams: parseQueryParamsFromUrl(request.url),
      bodyType: normalizedBodyType,
      bodyContent: request.body ?? "",
      bodyFormData:
        normalizedBodyType === "form-urlencoded"
          ? parseFormDataBody(request.body)
          : [createEmptyKeyValue()],
      rawContentType:
        normalizedBodyType === "json" ? "application/json" : "text/plain",
      response: null,
      isLoading: false,
      error: null,
      activeRequestTab: "params",
      activeResponseTab: "body",
    });

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));

    return tab.id;
  },
  syncQueryParamsToUrl: () => {
    const { tabs, activeTabId } = get();
    const targetTabId = activeTabId ?? tabs[0]?.id ?? null;
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
        tabs: updateTabById(state.tabs, targetTabId, {
          url: parsedUrl.toString(),
          isDirty: true,
        }),
      }));
    } catch {
      // Ignore malformed URLs while the user is typing.
    }
  },
  syncUrlToQueryParams: () => {
    const { tabs, activeTabId } = get();
    const targetTabId = activeTabId ?? tabs[0]?.id ?? null;
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
        tabs: updateTabById(state.tabs, targetTabId, {
          queryParams: [],
          isDirty: true,
        }),
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
        tabs: updateTabById(state.tabs, targetTabId, {
          queryParams: params,
          isDirty: true,
        }),
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
    const targetTabId = activeTabId ?? tabs[0]?.id ?? null;
    if (!targetTabId) {
      return;
    }

    const tab = tabs.find((item) => item.id === targetTabId);
    if (!tab) {
      return;
    }

    const payload: HttpRequestData = {
      method: tab.method,
      url: getBaseUrl(tab.url),
      headers: tab.headers.filter((header) => header.enabled).map(toApiKeyValue),
      query_params: tab.queryParams
        .filter((param) => param.enabled)
        .map(toApiKeyValue),
      body: toRequestBody(
        tab.bodyType,
        tab.bodyContent,
        tab.bodyFormData,
        tab.rawContentType,
      ),
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

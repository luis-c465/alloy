import { create } from "zustand";
import type {
  HttpFileRequest,
  HttpRequestData,
  HttpResponseData,
  KeyValue as ApiKeyValue,
  RequestBody,
} from "~/bindings";
import { sendRequest as sendRequestApi } from "~/lib/api";

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
  closeTab: (id: string) => void;
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
  openRequestInTab: (request: HttpFileRequest, filePath: string) => string;
  syncQueryParamsToUrl: () => void;
  syncUrlToQueryParams: () => void;
  sendRequest: () => Promise<void>;
}

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

const createDefaultTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: crypto.randomUUID(),
  name: "New Request",
  filePath: null,
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
  closeTab: (id) => {
    set((state) => {
      if (state.tabs.length <= 1) {
        const tab = createDefaultTab();
        return {
          tabs: [tab],
          activeTabId: tab.id,
        };
      }

      const currentIndex = state.tabs.findIndex((tab) => tab.id === id);
      if (currentIndex === -1) {
        return state;
      }

      const nextTabs = state.tabs.filter((tab) => tab.id !== id);
      latestRequestTokenByTab.delete(id);

      if (state.activeTabId !== id) {
        return { tabs: nextTabs };
      }

      const nextActiveTab = nextTabs[currentIndex] ?? nextTabs[currentIndex - 1] ?? null;
      return {
        tabs: nextTabs,
        activeTabId: nextActiveTab?.id ?? null,
      };
    });
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
  openRequestInTab: (request, filePath) => {
    const normalizedBodyType = normalizeBodyType(request.body_type);
    const tabName = request.name?.trim() || "New Request";
    const tab = createDefaultTab({
      name: tabName,
      filePath,
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
      const response = await sendRequestApi(payload);
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

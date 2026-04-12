import { create } from "zustand";

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  id: string;
}

export interface HttpResponseData {
  status: number;
  status_text: string;
  headers: KeyValue[];
  body: string;
  size_bytes: number;
  time_ms: number;
}

type BodyType = "none" | "json" | "form-urlencoded" | "raw";
type RequestTab = "params" | "headers" | "body";
type ResponseTab = "body" | "headers";

interface RequestStore {
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
  setMethod: (method: string) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setQueryParams: (params: KeyValue[]) => void;
  setBodyType: (type: BodyType) => void;
  setBodyContent: (content: string) => void;
  setBodyFormData: (data: KeyValue[]) => void;
  setResponse: (response: HttpResponseData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveRequestTab: (tab: RequestTab) => void;
  setActiveResponseTab: (tab: ResponseTab) => void;
  syncQueryParamsToUrl: () => void;
  syncUrlToQueryParams: () => void;
}

const createEmptyKeyValue = (): KeyValue => ({
  key: "",
  value: "",
  enabled: true,
  id: crypto.randomUUID(),
});

export const useRequestStore = create<RequestStore>()((set, get) => ({
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
  setMethod: (method) => set({ method }),
  setUrl: (url) => set({ url }),
  setHeaders: (headers) => set({ headers }),
  setQueryParams: (queryParams) => set({ queryParams }),
  setBodyType: (bodyType) => set({ bodyType }),
  setBodyContent: (bodyContent) => set({ bodyContent }),
  setBodyFormData: (bodyFormData) => set({ bodyFormData }),
  setResponse: (response) => set({ response }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setActiveRequestTab: (activeRequestTab) => set({ activeRequestTab }),
  setActiveResponseTab: (activeResponseTab) => set({ activeResponseTab }),
  syncQueryParamsToUrl: () => {
    const { url, queryParams } = get();

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

      set({ url: parsedUrl.toString() });
    } catch {
      // Ignore malformed URLs while the user is typing.
    }
  },
  syncUrlToQueryParams: () => {
    const { url } = get();

    if (!url.trim()) {
      set({ queryParams: [] });
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

      set({ queryParams: params });
    } catch {
      // Ignore malformed URLs while the user is typing.
    }
  },
}));

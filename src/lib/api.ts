// Uses generated TauRPC types/proxy from src/bindings.ts.
import { createTauRPCProxy } from "~/bindings";
import type { HttpRequestData, HttpResponseData } from "~/bindings";

const api = createTauRPCProxy();

export { api };

export const sendRequest = async (
  data: HttpRequestData,
): Promise<HttpResponseData> => {
  return api.send_request(data);
};

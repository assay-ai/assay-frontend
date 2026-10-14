import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

/**
 * Test helpers for the operator console: an in-memory `localStorage` behind a
 * stubbed `window`, and a scripted axios adapter. Imported by tests only.
 */
export function memoryStorage(): Storage & { dump(): Record<string, string> } {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    dump: () => Object.fromEntries(data),
  };
}

export interface ScriptedCall {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

/** Answers each request with `(call) => [status, body]`; 4xx/5xx reject like axios does. */
export function scriptedAdapter(answer: (call: ScriptedCall) => [number, unknown]) {
  const calls: ScriptedCall[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const call: ScriptedCall = {
      method: (config.method ?? "get").toUpperCase(),
      url: config.url ?? "",
      authorization: config.headers.Authorization as string | undefined,
      body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    };
    calls.push(call);
    const [status, data] = answer(call);
    const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) throw new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response);
    return response;
  };
  return { adapter, calls };
}

export const envelope = (data: unknown, statusCode = 200) => ({ data, statusCode, message: "Success" });

export const failure = (code: string, statusCode: number, message = code) => ({
  success: false,
  error: { code, message, statusCode },
});

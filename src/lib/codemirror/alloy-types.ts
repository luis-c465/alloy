/**
 * Generates the ambient TypeScript declaration string for the `alloy` global
 * that is injected into the virtual TS environment used by the script editors.
 *
 * The `alloy.response` namespace is only available in post-response scripts,
 * so we generate two variants based on `scriptType`.
 */
export type ScriptType = "pre" | "post";

export function getAlloyDeclaration(scriptType: ScriptType): string {
  const responseDecl =
    scriptType === "post"
      ? `
  /**
   * The HTTP response received from the server.
   * Only available in post-response scripts.
   */
  readonly response: AlloyResponse;`
      : "";

  return `
/** A collection of key-value pairs (headers, query params, etc.) */
interface AlloyKeyValueCollection {
  /**
   * Get the value for a key. Returns undefined if the key does not exist.
   */
  get(key: string): string | undefined;

  /**
   * Add a new key-value pair. If the key already exists a duplicate is added.
   */
  add(key: string, value: string): void;

  /**
   * Set a key to a value, replacing any existing entry with the same key.
   */
  upsert(key: string, value: string): void;

  /**
   * Remove all entries with the given key.
   */
  remove(key: string): void;

  /**
   * Return all entries as a plain object.
   * When multiple values exist for a key the last one wins.
   */
  toObject(): Record<string, string>;
}

/** The outgoing HTTP request. Available in both pre-request and post-response scripts. */
interface AlloyRequest {
  /** HTTP method, e.g. "GET", "POST". Writable in pre-request scripts. */
  method: string;

  /** Full request URL including query string. Writable in pre-request scripts. */
  url: string;

  /**
   * Raw request body as a string, or null when there is no body.
   * Writable in pre-request scripts.
   */
  body: string | null;

  /** Request headers. Use the collection methods to read and modify them. */
  readonly headers: AlloyKeyValueCollection;

  /** URL query parameters. Use the collection methods to read and modify them. */
  readonly queryParams: AlloyKeyValueCollection;
}

/** The HTTP response received from the server. Only available in post-response scripts. */
interface AlloyResponse {
  /** HTTP status code, e.g. 200, 404. */
  readonly code: number;

  /** HTTP status text, e.g. "OK", "Not Found". */
  readonly status: string;

  /** Time taken for the request to complete, in milliseconds. */
  readonly responseTime: number;

  /** Size of the response body in bytes. */
  readonly responseSize: number;

  /** Response headers (read-only). */
  readonly headers: {
    /** Get the value of a response header. Returns undefined if absent. */
    get(key: string): string | undefined;
    /** Return all response headers as a plain object. */
    toObject(): Record<string, string>;
  };

  /** Return the raw response body as a string. */
  text(): string;

  /**
   * Parse the response body as JSON and return the result.
   * Throws if the body is not valid JSON.
   */
  json(): unknown;
}

/** A mutable key-value store for environment or script-local variables. */
interface AlloyStore {
  /**
   * Get the value of a variable. Returns undefined if the key does not exist.
   */
  get(key: string): string | undefined;

  /**
   * Set a variable. Creates it if it does not exist, otherwise updates it.
   */
  set(key: string, value: string): void;

  /**
   * Returns true if the variable exists.
   */
  has(key: string): boolean;

  /**
   * Delete a variable. No-op if the key does not exist.
   */
  unset(key: string): void;

  /**
   * Return all variables as a plain object.
   */
  toObject(): Record<string, string>;
}

/** Metadata about the currently executing script. */
interface AlloyInfo {
  /** Whether this is a pre-request or post-response script. */
  readonly eventName: "pre-request" | "post-response";

  /** The name of the request being sent, or null if unnamed. */
  readonly requestName: string | null;
}

/** Console output from scripts. Messages appear in the Console tab. */
interface AlloyConsole {
  /** Log a message at the default level. */
  log(...args: unknown[]): void;
  /** Log a warning message. */
  warn(...args: unknown[]): void;
  /** Log an error message. */
  error(...args: unknown[]): void;
  /** Log an informational message. */
  info(...args: unknown[]): void;
  /** Log a debug message. */
  debug(...args: unknown[]): void;
}

/** The Alloy scripting API. Available as a global \`alloy\` object in all scripts. */
interface AlloyAPI {
  /**
   * The outgoing HTTP request.
   * In pre-request scripts you can modify method, url, body, headers, and queryParams.
   */
  readonly request: AlloyRequest;
${responseDecl}
  /**
   * Persistent environment variables for the active environment.
   * Changes made here are visible to subsequent requests.
   */
  readonly environment: AlloyStore;

  /**
   * Script-local variables that are scoped to this request execution.
   * Changes here are not persisted between requests.
   */
  readonly variables: AlloyStore;

  /** Metadata about the currently running script. */
  readonly info: AlloyInfo;

  /** Write messages to the Console tab. */
  readonly console: AlloyConsole;
}

declare global {
  /** The Alloy scripting API. Use this object to read and modify the request/response. */
  const alloy: AlloyAPI;

  /**
   * Console output — proxies to \`alloy.console\`.
   * Use this for logging just like you would in a browser.
   */
  const console: AlloyConsole;
}

export {};
`;
}

/** JACO zero-dependency native ESM SDK.
 * Adapted from JACO-CODE archive 2026-10-29.
 * Calls that mutate state are never retried automatically.
 */
class JacoApiError extends Error {
  constructor(status, code, message, details) {
    super("[JACO_SDK_HTTP_" + status + "] " + code + ": " + message);
    this.name = "JacoApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
class JacoClient {
  constructor({endpoint, token = "", timeoutMs = 30000, retries = 2, retryDelayMs = 500, fetchImpl} = {}) {
    const origin = typeof window !== "undefined" ? window.location?.origin : null;
    this.endpoint = String(endpoint || origin || "http://127.0.0.1:3000").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(this.endpoint)) throw new TypeError("JACO endpoint must be an HTTP(S) URL");
    this.token = String(token);
    this.timeoutMs = timeoutMs;
    this.retries = Math.max(0, Math.min(5, Math.trunc(retries)));
    this.retryDelayMs = Math.max(0, retryDelayMs);
    this.fetcher = fetchImpl || globalThis.fetch;
    if (typeof this.fetcher !== "function") throw new TypeError("JACO SDK requires fetch");
  }
  async request(path, {method = "GET", body, headers = {}, signal} = {}) {
    const verb = method.toUpperCase();
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) throw new TypeError("JACO SDK requests require relative /paths");
    const url = new URL(path, this.endpoint);
    if (url.origin !== new URL(this.endpoint).origin) throw new TypeError("Cross-origin SDK request blocked");
    const requestHeaders = {Accept: "application/json", ...headers};
    if (body !== undefined && body !== null) requestHeaders["Content-Type"] = "application/json";
    if (this.token) requestHeaders["x-gateway-token"] = this.token;
    const attempts = (verb === "GET" || verb === "HEAD") ? this.retries + 1 : 1;
    let lastError;
    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, {once:true});
      const timeout = setTimeout(() => controller.abort(new Error("JACO_SDK_TIMEOUT")), this.timeoutMs);
      try {
        const response = await this.fetcher(url.toString(), {
          method:verb, headers:requestHeaders, signal:controller.signal,
          ...(body !== undefined ? {body:typeof body === "string" ? body : JSON.stringify(body)} : {})
        });
        const raw = await response.text();
        let data;
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = {raw:raw.slice(0, 500)}; }
        if (!response.ok || data?.success === false) {
          const detail = data?.error || data?.detail || data?.message;
          const code = typeof detail === "string" ? detail : detail?.code || "HTTP_" + response.status;
          const message = typeof detail === "string" ? detail : detail?.message || response.statusText || "API_ERROR";
          const error = new JacoApiError(response.status, code, message, data);
          if ((response.status === 429 || response.status >= 500) && i + 1 < attempts && !signal?.aborted) lastError = error;
          else throw error;
        } else return data;
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error instanceof JacoApiError && !(error.status === 429 || error.status >= 500) || i + 1 === attempts) throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
      if (signal?.aborted) throw signal.reason || new Error("SDK request cancelled");
      await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * (2 ** i)));
    }
    throw lastError;
  }
  workbench = {
    status:() => this.request("/api/aura/workbench"),
    files:() => this.request("/api/aura/workbench/files"),
    getFile:path => this.request("/api/aura/workbench/file?path=" + encodeURIComponent(path)),
    saveFile:(path, content) => this.request("/api/aura/workbench/file", {method:"PUT", body:{path,content}})
  };
  missions = {
    list:async (limit=50) => {
      const data = await this.request("/api/connected/missions?limit=" + Math.min(500, Math.max(1, Math.trunc(limit))));
      return {missions:data.missions || data.items || []};
    },
    startGoal:goal => this.request("/api/aura/workbench/start-goal", {method:"POST", body:{goal}}),
    review:id => this.request("/api/aura/workbench/missions/" + encodeURIComponent(id) + "/review"),
    cancel:id => this.request("/api/aura/workbench/missions/" + encodeURIComponent(id) + "/cancel", {method:"POST"})
  };
  chat = {
    send:async (message, options={}) => {
      const r = await this.request("/api/aura/chat", {method:"POST", body:{message,text:message,...options}});
      return {...r, response:r.response || r.reply || r.text || ""};
    }
  };
  providers = {
    list:async () => {
      const {providers} = await this.workbench.status();
      return Array.isArray(providers) ? providers : Array.isArray(providers?.active) ? providers.active : [];
    }
  };
  tools = {
    list:async () => {
      const s=await this.workbench.status();
      return (s.mcp?.providers || []).flatMap(p=>(p.tools || []).map(t=>({...t,providerId:p.id,providerName:p.name})));
    },
    call:async (toolName,args={},providerId) => {
      if (!providerId) {
        const found=(await this.tools.list()).find(t=>t.name===toolName);
        if (!found) throw new Error("Tool not found: " + toolName);
        providerId=found.providerId;
      }
      return this.request("/api/aura/workbench/mcp/call", {method:"POST",body:{providerId,toolName,arguments:args}});
    }
  };
  approvals = {
    list:async () => (await this.workbench.status()).approvals?.items || [],
    decide:(id,decision,reason) => {
      if (!["approve","approved","reject","rejected"].includes(decision)) throw new TypeError("Invalid approval decision");
      return this.request("/api/aura/workbench/approvals/" + encodeURIComponent(id) + "/decision", {
        method:"POST",body:{decision:decision.startsWith("approve")?"approve":"reject",reason}
      });
    }
  };
}
export { JacoApiError, JacoClient };
export const createJacoClient = config => new JacoClient(config);
export default JacoClient;

/**
 * Backend origin for fetch(). Paths in this app are like `/api/...` or `/t/...`, so the env value must not
 * duplicate `/api`. If someone sets VITE_API_BASE=http://host:8003/api, strip the trailing /api.
 */
function normalizedApiPrefix(): string {
  let p = (import.meta.env.VITE_API_BASE ?? "").trim();
  if (!p) return "";
  p = p.replace(/\/+$/, "");
  if (p.toLowerCase().endsWith("/api")) {
    p = p.slice(0, -4).replace(/\/+$/, "");
  }
  return p;
}

const prefix = normalizedApiPrefix();

function mergeInit(init?: RequestInit): RequestInit {
  return { ...init };
}

/** Same normalization for candidate links + `/t/api/*` JSON (prefers VITE_PUBLIC_API_URL). */
export function backendOrigin(): string {
  const pub = (import.meta.env.VITE_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
  if (pub) return pub;
  return prefix;
}

/** Structured API failure (HTTP error or non-2xx with JSON body). */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Turn errors into UI text. For API errors, include the server `detail` when present
 * (e.g. JD Q&A when Azure LLM env is missing) instead of only the numeric status.
 */
export function formatUserError(e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.detail || "").trim();
    if (!d || d === String(e.status)) return String(e.status);
    const max = 320;
    const body = d.length > max ? `${d.slice(0, max - 1)}…` : d;
    return `${e.status}: ${body}`;
  }
  if (e instanceof Error) {
    const m = e.message.match(/\b([1-5]\d{2})\b/);
    return m ? m[1] : "500";
  }
  const m = String(e).match(/\b([1-5]\d{2})\b/);
  return m ? m[1] : "500";
}

export function parseErrorBody(status: number, text: string): ApiError {
  const raw = text.trim();
  const looksLikeHtml = /<!doctype html>|<html[\s>]|<head[\s>]|<body[\s>]/i.test(raw);
  let detail = raw || String(status);
  if (looksLikeHtml) {
    // Avoid exposing raw nginx/proxy HTML to users; show numeric status only.
    detail = String(status);
    return new ApiError(status, detail);
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.message === "string" && j.message.trim()) {
      detail = j.message.trim();
    } else if (typeof j.detail === "string" && j.detail.trim()) {
      detail = j.detail.trim();
    } else if (Array.isArray(j.detail)) {
      detail = (j.detail as { msg?: string; loc?: unknown }[])
        .map((x) => {
          const loc = Array.isArray(x.loc) ? x.loc.filter((p) => p !== "body").join(".") : "";
          const m = x.msg || JSON.stringify(x);
          return loc ? `${loc}: ${m}` : m;
        })
        .join("; ");
    }
  } catch {
    detail = String(status);
  }
  return new ApiError(status, detail);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const merged = mergeInit(init);
  const headers: Record<string, string> = {
    ...(merged.headers as Record<string, string>),
  };
  const method = (merged.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method) && merged.body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const r = await fetch(url, {
    ...merged,
    headers,
  });
  const text = await r.text();
  if (!r.ok) {
    throw parseErrorBody(r.status, text);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = prefix ? `${prefix}${path}` : path;
  return fetchJson<T>(url, init);
}

/** For paths that must hit the API host root (`/t/...`, `/t/api/...`), not `origin + /api + path`. */
export async function apiJsonFromOrigin<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = backendOrigin();
  const url = origin ? `${origin}${path.startsWith("/") ? path : `/${path}`}` : path;
  return fetchJson<T>(url, init);
}

export function apiUrl(path: string): string {
  return `${prefix}${path}`;
}

export async function apiDelete<T = Record<string, unknown>>(path: string): Promise<T> {
  const r = await fetch(`${prefix}${path}`, mergeInit({ method: "DELETE" }));
  const text = await r.text();
  if (!r.ok) {
    throw parseErrorBody(r.status, text);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

/** POST multipart form and parse JSON response. */
export async function apiFormPostJson<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(`${prefix}${path}`, mergeInit({ method: "POST", body: form }));
  const text = await r.text();
  if (!r.ok) {
    throw parseErrorBody(r.status, text);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export type FormUploadPhase = "uploading" | "transcribing";

/**
 * POST multipart with upload progress; calls onPhase("transcribing") when bytes are sent.
 */
export function apiFormPostJsonWithUploadProgress<T>(
  path: string,
  form: FormData,
  onPhase?: (phase: FormUploadPhase) => void
): Promise<T> {
  const url = prefix ? `${prefix}${path}` : path;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    let uploadFinished = false;
    xhr.upload.addEventListener("progress", () => {
      onPhase?.("uploading");
    });
    xhr.upload.addEventListener("load", () => {
      uploadFinished = true;
      onPhase?.("transcribing");
    });

    xhr.addEventListener("load", () => {
      const text = xhr.responseText || "";
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(parseErrorBody(xhr.status, text));
        return;
      }
      if (!text) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(text) as T);
      } catch {
        reject(new ApiError(xhr.status, String(xhr.status)));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error(uploadFinished ? "500" : "500"));
    });
    xhr.addEventListener("abort", () => {
      reject(new Error("500"));
    });
    onPhase?.("uploading");
    xhr.send(form);
  });
}

export type StreamEvent = {
  type: string;
  id?: string;
  phase?: string;
  message?: string;
  payload?: Record<string, unknown>;
};

/** POST multipart and consume Server-Sent Events from LangGraph agent pipeline. */
export async function apiFormPostStream<T>(
  path: string,
  form: FormData,
  onEvent: (event: StreamEvent) => void
): Promise<T> {
  const url = prefix ? `${prefix}${path}` : path;
  const r = await fetch(url, mergeInit({ method: "POST", body: form }));
  if (!r.ok) {
    throw parseErrorBody(r.status, await r.text());
  }
  if (!r.body) {
    throw new ApiError(500, "No response body from agent stream");
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          onEvent(event);
          if (event.type === "result" && event.payload) {
            result = event.payload as T;
          }
          if (event.type === "error") {
            throw new ApiError(500, event.message || "Agent pipeline failed");
          }
        } catch (e) {
          if (e instanceof ApiError) throw e;
        }
      }
    }
  }
  if (!result) {
    throw new ApiError(500, "Agent pipeline returned no result");
  }
  return result;
}

export type DownloadFile = {
  blob: Blob;
  name: string;
};

export function triggerDownload(file: DownloadFile): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file.blob);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadPost(path: string, body: unknown, filenameHint: string): Promise<DownloadFile> {
  const r = await fetch(
    `${prefix}${path}`,
    mergeInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  if (!r.ok) {
    throw parseErrorBody(r.status, await r.text());
  }
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition");
  let name = filenameHint;
  if (cd) {
    const m = cd.match(/filename="?([^";]+)"?/);
    if (m) name = m[1];
  }
  return { blob, name };
}

export async function downloadForm(path: string, form: FormData, filenameHint: string): Promise<DownloadFile> {
  const r = await fetch(`${prefix}${path}`, mergeInit({ method: "POST", body: form }));
  if (!r.ok) {
    throw parseErrorBody(r.status, await r.text());
  }
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition");
  let name = filenameHint;
  if (cd) {
    const m = cd.match(/filename="?([^";]+)"?/);
    if (m) name = m[1];
  }
  return { blob, name };
}

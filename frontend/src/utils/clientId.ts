/**
 * Stable-enough unique id for React keys. Works when the page is served over plain HTTP
 * (e.g. http://<server-ip>/...) where `crypto.randomUUID` is not available (non-secure context).
 */
export function randomClientId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

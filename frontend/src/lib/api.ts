// The UI (Vite, :8501) and the API (FastAPI, :8500) are different origins,
// so EVERY url the API hands back (players, clips, exports) goes through
// api() - a bare relative url would resolve against the UI server and 404.
declare global {
  interface Window {
    CVE_API_BASE?: string
  }
}

export const API_BASE: string =
  window.CVE_API_BASE ??
  import.meta.env.VITE_API_BASE ??
  `${location.protocol}//${location.hostname}:8500`

export const api = (path: string) => API_BASE + path

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(api(path), init)
  const data = (await res.json().catch(() => ({}))) as T & { detail?: unknown }
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : `${res.status} ${res.statusText}`
    throw new Error(detail)
  }
  return data
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return getJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

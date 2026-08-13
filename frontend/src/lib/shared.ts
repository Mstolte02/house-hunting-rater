const API_URL = String(import.meta.env.VITE_HOUSE_HUNT_API_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "house-hunt-editor-token-v1";

export type SharedStateSnapshot<T> = { data: T; revision: number };
export type SharedStatus = "local" | "loading" | "online" | "offline";

let status: SharedStatus = API_URL ? "loading" : "local";
let editor = !!sessionStorage.getItem(TOKEN_KEY);
const listeners = new Set<() => void>();

function announce() { listeners.forEach((listener) => listener()); }
function setStatus(next: SharedStatus) { status = next; announce(); }

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, init);
  let body: any = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      editor = false;
      announce();
    }
    const error = new Error(body?.error || `Shared service returned ${response.status}.`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body;
}

export function sharedConfigured() { return !!API_URL; }
export function sharedStatus() { return status; }
export function canEdit() { return !API_URL || editor; }
export function subscribeShared(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function loadSharedState<T>(): Promise<SharedStateSnapshot<T> | null> {
  if (!API_URL) return null;
  try {
    const snapshot = await request("/state");
    setStatus("online");
    return snapshot;
  } catch (error) {
    setStatus("offline");
    console.warn("Using the cached House Hunt data because shared sync is unavailable.", error);
    return null;
  }
}

export function requireEditor() {
  if (API_URL && !editor) throw new Error("Unlock editing with the password before making changes.");
}

export async function saveSharedState<T>(data: T, revision: number): Promise<number> {
  if (!API_URL) return revision;
  requireEditor();
  const token = sessionStorage.getItem(TOKEN_KEY);
  const result = await request("/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data, revision }),
  });
  setStatus("online");
  return Number(result.revision);
}

export async function unlockEditing(password: string) {
  if (!API_URL) return;
  const result = await request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  sessionStorage.setItem(TOKEN_KEY, result.token);
  editor = true;
  announce();
}

export async function validateEditorSession() {
  if (!API_URL || !editor) return;
  try {
    await request("/session", { headers: { Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY)}` } });
  } catch { /* request clears an expired token */ }
}

export function lockEditing() {
  sessionStorage.removeItem(TOKEN_KEY);
  editor = false;
  announce();
}

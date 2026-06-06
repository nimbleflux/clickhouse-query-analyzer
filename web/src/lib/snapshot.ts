import type { Location } from "react-router-dom";

export interface EditorSnapshot {
  sql: string;
  parameters?: Record<string, string>;
  settings?: Record<string, string>;
  origin?: string;
  v: 1;
}

function encodeJson(input: unknown): string {
  const json = JSON.stringify(input);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJson<T>(encoded: string): T | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

const SNAPSHOT_PREFIX = "s=";

export function encodeSnapshot(snapshot: EditorSnapshot): string {
  return `#${SNAPSHOT_PREFIX}${encodeJson(snapshot)}`;
}

export function decodeSnapshot(hash: string): EditorSnapshot | null {
  const stripped = hash.replace(/^#/, "");
  if (!stripped.startsWith(SNAPSHOT_PREFIX)) return null;
  const encoded = stripped.slice(SNAPSHOT_PREFIX.length);
  const decoded = decodeJson<EditorSnapshot>(encoded);
  if (!decoded || decoded.v !== 1 || typeof decoded.sql !== "string") return null;
  return decoded;
}

export function readSnapshotFromLocation(location: Location): EditorSnapshot | null {
  if (!location.hash) return null;
  return decodeSnapshot(location.hash);
}

export function buildShareableUrl(snapshot: EditorSnapshot): string {
  return `${window.location.origin}${window.location.pathname}${encodeSnapshot(snapshot)}`;
}

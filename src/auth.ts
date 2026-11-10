// Who may reach a space. Set per space in space.json `auth`:
//   "open"   anyone with the address (the default)
//   "token"  one shared secret: `Authorization: Bearer <token>` (auth.json `token`)
//   "device" every phone signs every request with its own key; a phone the server doesn't know yet must bring an
//            invite code once. No shared secret travels, a copied request can't be replayed, one phone can be revoked.
// The server keeps the secrets in <space>/auth.json (never served):
//   { "token"?: "…", "invites"?: [{ "code": "ABCD-EFGH", "uses"?: 1 | null, "note"?: "…" }],
//     "devices"?: [{ "key": "<base64 public key>", "device": "<phone id>", "added": "<ISO time>", "note"?: "…" }] }
// A signed request carries X-Chameloon-Key (P-256 public key, X9.63, base64), X-Chameloon-Time (Unix ms) and
// X-Chameloon-Signature (ECDSA P-256 / SHA-256 over `METHOD\npath?query\ntime\nsha256(body) hex`, raw r||s, base64).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AuthMode = "open" | "token" | "device";
export type Invite = { code: string; uses?: number | null; note?: string };
export type Device = { key: string; device?: string; added: string; note?: string };
export type AuthFile = { token?: string; invites?: Invite[]; devices?: Device[] };

const SKEW = 5 * 60 * 1000; // how far a phone's clock may be off
const seen = new Map<string, number>(); // signatures used in the last minutes: a replay is refused

export const authFile = (dir: string) => join(dir, "auth.json");
export const readAuth = (dir: string): AuthFile => (existsSync(authFile(dir)) ? JSON.parse(readFileSync(authFile(dir), "utf8")) : {});
export const writeAuth = (dir: string, a: AuthFile) => writeFileSync(authFile(dir), JSON.stringify(a, null, 2));

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
/** Compares secrets in constant time, so the answer time doesn't give away how much of a guess was right. */
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** What a phone signs. Also used by tests and other clients. */
export async function canonical(method: string, pathAndQuery: string, time: string, body: Uint8Array) {
  return `${method.toUpperCase()}\n${pathAndQuery}\n${time}\n${hex(await crypto.subtle.digest("SHA-256", new Uint8Array(body)))}`;
}

type Verdict = { ok: true } | { ok: false; status: number; error: string };

/** Checks a request against the space's `auth`. `body` is the raw request body (empty for GET). */
export async function checkAccess(dir: string, mode: AuthMode | undefined, req: Request, body: Uint8Array): Promise<Verdict> {
  if (!mode || mode === "open") return { ok: true };
  const auth = readAuth(dir);
  if (mode === "token") {
    const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    return auth.token && equal(given, auth.token) ? { ok: true } : { ok: false, status: 401, error: "This space needs its token." };
  }
  // device
  const key = req.headers.get("x-chameloon-key") ?? "";
  const time = req.headers.get("x-chameloon-time") ?? "";
  const sig = req.headers.get("x-chameloon-signature") ?? "";
  if (!key || !time || !sig) return { ok: false, status: 401, error: "This space needs a signed request from the Chameloon app." };
  if (!(Math.abs(Date.now() - Number(time)) < SKEW)) return { ok: false, status: 401, error: "The phone's clock is off by more than 5 minutes." };
  if (seen.has(sig)) return { ok: false, status: 401, error: "This request was already used." };
  try {
    const pub = await crypto.subtle.importKey("raw", b64(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const url = new URL(req.url);
    const data = new TextEncoder().encode(await canonical(req.method, url.pathname + url.search, time, body));
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64(sig), data))) throw new Error();
  } catch {
    return { ok: false, status: 401, error: "The signature doesn't match." };
  }
  const now = Date.now();
  seen.set(sig, now);
  for (const [s, t] of seen) if (now - t > 2 * SKEW) seen.delete(s);

  if ((auth.devices ?? []).some((d) => d.key === key)) return { ok: true };
  // a phone the server doesn't know yet: its invite code lets it in, once per code use
  const code = req.headers.get("x-chameloon-invite") ?? "";
  const invite = (auth.invites ?? []).find((i) => code && equal(i.code, code) && (i.uses == null || i.uses > 0));
  if (!invite) return { ok: false, status: 401, error: "This space needs an invite code." };
  if (invite.uses != null) invite.uses -= 1;
  auth.invites = (auth.invites ?? []).filter((i) => i.uses == null || i.uses > 0);
  auth.devices = [...(auth.devices ?? []), { key, device: req.headers.get("x-chameloon-device") ?? undefined, added: new Date().toISOString(), note: invite.note }];
  writeAuth(dir, auth);
  return { ok: true };
}

/** A new invite code like "K7QM-3XRP" (no 0/O/1/I). */
export function newInvite(dir: string, uses: number | null = 1, note?: string): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => abc[b % abc.length]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const auth = readAuth(dir);
  auth.invites = [...(auth.invites ?? []), { code, uses, ...(note ? { note } : {}) }];
  writeAuth(dir, auth);
  return code;
}

/** Removes the phones whose key or phone id starts with `prefix`; returns how many. */
export function revoke(dir: string, prefix: string): number {
  const auth = readAuth(dir);
  const before = auth.devices?.length ?? 0;
  auth.devices = (auth.devices ?? []).filter((d) => !(d.key.startsWith(prefix) || d.device?.startsWith(prefix)));
  writeAuth(dir, auth);
  return before - auth.devices.length;
}

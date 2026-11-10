// Access rules of the self-hosting server (src/auth.ts), with a client that signs like the app does.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, createHandler, newInvite, readAuth, revoke } from "./src/server.ts";

const root = mkdtempSync(join(tmpdir(), "auth-"));
const space = (name: string, auth: string, extra: object = {}) => {
  mkdirSync(join(root, name, "pages"), { recursive: true });
  writeFileSync(join(root, name, "space.json"), JSON.stringify({ name, version: 1, auth, sync: { tables: [] }, schema: [] }));
  writeFileSync(join(root, name, "pages", "home.oui"), "root = Page([])");
  writeFileSync(join(root, name, "auth.json"), JSON.stringify(extra));
};
space("open", "open");
space("shared", "token", { token: "s3cret-token" });
space("locked", "device", { invites: [{ code: "ABCD-EFGH", uses: 1 }] });
const handle = createHandler(root);

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
async function phone() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const key = b64(await crypto.subtle.exportKey("raw", keys.publicKey)); // X9.63, as CryptoKit's x963Representation
  let last = 0;
  return {
    key,
    async request(method: string, path: string, opts: { body?: object; invite?: string; time?: number; sign?: string } = {}) {
      const body = opts.body ? new TextEncoder().encode(JSON.stringify(opts.body)) : new Uint8Array();
      const time = String(opts.time ?? (last = Math.max(Date.now(), last + 1))); // never the same text twice
      const data = new TextEncoder().encode(await canonical(method, path, time, body));
      const sig = opts.sign ?? b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, data));
      const headers: Record<string, string> = { "x-chameloon-key": key, "x-chameloon-time": time, "x-chameloon-signature": sig, "x-chameloon-device": "phone-1" };
      if (opts.invite) headers["x-chameloon-invite"] = opts.invite;
      return new Request(`http://x${path}`, { method, headers, body: opts.body ? body : undefined });
    },
  };
}

test("open spaces need nothing; token spaces need their token", async () => {
  expect((await handle(new Request("http://x/open/space"))).status).toBe(200);
  expect((await handle(new Request("http://x/shared/space"))).status).toBe(401);
  expect((await handle(new Request("http://x/shared/space", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  expect((await handle(new Request("http://x/shared/space", { headers: { authorization: "Bearer s3cret-token" } }))).status).toBe(200);
});

test("device spaces: a signed phone with an invite gets in once, then by its key alone", async () => {
  const p = await phone();
  expect((await handle(new Request("http://x/locked/space"))).status).toBe(401); // unsigned
  const noInvite = await handle(await p.request("GET", "/locked/space"));
  expect(noInvite.status).toBe(401);
  expect(((await noInvite.json()) as { error: string }).error).toContain("invite");
  expect((await handle(await p.request("GET", "/locked/space", { invite: "ABCD-EFGH" }))).status).toBe(200);
  expect(readAuth(join(root, "locked")).devices?.[0]).toMatchObject({ key: p.key, device: "phone-1" });
  expect(readAuth(join(root, "locked")).invites).toEqual([]); // used up
  // known now: no invite needed, and a POST body is covered by the signature
  expect((await handle(await p.request("POST", "/locked/sync", { body: { device: "phone-1", ops: [], cursor: 0 } }))).status).toBe(200);
  // the used invite doesn't let a second phone in
  const other = await phone();
  expect((await handle(await other.request("GET", "/locked/space", { invite: "ABCD-EFGH" }))).status).toBe(401);
});

test("device spaces refuse replays, forged or tampered requests, old clocks, and revoked phones", async () => {
  const p = await phone();
  const code = newInvite(join(root, "locked"), 1, "test");
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const first = await p.request("GET", "/locked/space", { invite: code });
  const copy = first.clone() as Request;
  expect((await handle(first)).status).toBe(200);
  expect((await handle(copy)).status).toBe(401); // the same signature twice
  const forged = await p.request("GET", "/locked/space", { sign: b64(new Uint8Array(64).buffer) });
  expect((await handle(forged)).status).toBe(401);
  // a signature for one path doesn't open another
  const signed = await p.request("GET", "/locked/space");
  const moved = new Request("http://x/locked/img/a.png", { headers: signed.headers });
  expect((await handle(moved)).status).toBe(401);
  expect((await handle(await p.request("GET", "/locked/space", { time: Date.now() - 10 * 60 * 1000 }))).status).toBe(401);
  expect(revoke(join(root, "locked"), p.key.slice(0, 12))).toBe(1);
  expect((await handle(await p.request("GET", "/locked/space"))).status).toBe(401);
});

test("hooks aren't device-signed: the bot checks its caller", async () => {
  expect((await handle(new Request("http://x/locked/hook", { method: "POST", body: "{}" }))).status).toBe(404); // reached the space (it has no hook)
});

// A server for any number of spaces: /<space>/space, /<space>/sync, /<space>/img/<file>, /<space>/hook.
// Each space lives in <root>/<name>/ (space.json + pages/*.oui + optional img/ and bot.ts or bot.js).
// Plain fetch Request → Response, so it runs on Bun, Node (serve() below), Deno, or inside another server.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join } from "node:path";

import { checkAccess, type AuthMode } from "./auth.ts";

export { canonical, newInvite, readAuth, revoke, type AuthFile, type AuthMode } from "./auth.ts";

const load = createRequire(import.meta.url);

export type Row = Record<string, unknown> & { id: string };
export type Op = { id: string; op: "upsert" | "delete" | "event"; table: string; row: Row; at: string };

/** What a space's bot.ts gets: the rows the server holds, and a way to send rows to the phone. */
export interface Store {
  rows(table: string): Row[];
  /** Saves a row and sends it to the phone on its next sync. */
  put(table: string, row: Row): void;
  /** A notification for every device of this space, delivered with its next sync (if the user allows them). */
  notify(title: string, body: string): void;
}
export interface Bot {
  /** Runs on every sync before the pull is built (live data, delayed answers). */
  tick?(store: Store): void;
  /** Runs for each change a phone sent (a chat message, a new meal). `device` is that phone's ID for this space. */
  onOp?(op: Op, store: Store, device: string): void;
  /** A page's Mutation("send", {event, data}): something the app tells the server (a button, what the phone knows).
   *  Not stored as a row; answer with store.put / store.notify. Comes with the next sync, so also after being offline. */
  onEvent?(event: string, data: unknown, store: Store, device: string): void;
  /** POST /<space>/hook: another service answers (an n8n workflow calling back). The bot checks who's calling. */
  hook?(body: Record<string, unknown>, store: Store, headers: Headers): unknown;
}

// `origin` is the device that wrote a row, or "server" for rows the bot wrote.
type Data = { seq: number; seen: string[]; devices: Record<string, number>; push: Record<string, string>; notes: Record<string, { title: string; body: string }[]>; rows: Record<string, Record<string, { row: Row; seq: number; origin: string }>> };

const WEEK = 7 * 24 * 3600 * 1000;

function space(dir: string) {
  const file = join(dir, "server-data.json");
  const data: Data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { seq: 0, seen: [], devices: {}, rows: {} };
  if (!data.devices || Array.isArray(data.devices)) data.devices = {}; // older files kept a plain list
  data.notes ??= {};
  data.push ??= {};
  const save = () => writeFileSync(file, JSON.stringify(data));
  const table = (t: string) => (data.rows[t] ??= {});
  const store: Store = {
    rows: (t) => Object.values(table(t)).map((r) => r.row),
    put: (t, row) => {
      table(t)[row.id] = { row, seq: ++data.seq, origin: "server" };
    },
    // Only devices that synced in the last week get it, and at most the 20 newest wait per device.
    notify: (title, body) => {
      const cutoff = Date.now() - WEEK;
      for (const [d, at] of Object.entries(data.devices)) {
        if (at < cutoff) {
          delete data.devices[d];
          delete data.notes[d];
          continue;
        }
        const queue = () => {
          (data.notes[d] ??= []).push({ title, body });
          data.notes[d] = data.notes[d].slice(-20);
        };
        const url = data.push[d];
        if (!url) {
          queue();
          continue;
        }
        // Through the relay, so it arrives even with the app closed. If that fails, it waits for the next sync.
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) })
          .then((r) => {
            if (!r.ok) throw new Error(`relay answered ${r.status}`);
          })
          .catch(() => {
            delete data.push[d];
            queue();
            save();
          });
      }
    },
  };
  const botFile = ["bot.ts", "bot.js"].map((f) => join(dir, f)).find(existsSync);
  const bot: Bot = botFile ? load(botFile) : {};

  return {
    /** The space's access rule from space.json (read each time, so changing it needs no restart). */
    auth(): AuthMode | undefined {
      return JSON.parse(readFileSync(join(dir, "space.json"), "utf8")).auth;
    },
    pkg() {
      const meta = JSON.parse(readFileSync(join(dir, "space.json"), "utf8"));
      const { pageScroll = {}, $schema: _, ...pkg } = meta as { pageScroll?: Record<string, string>; $schema?: string };
      const pages = Object.fromEntries(
        readdirSync(join(dir, "pages")).map((f) => {
          const name = basename(f, ".oui");
          const ui = readFileSync(join(dir, "pages", f), "utf8");
          return [name, pageScroll[name] ? { ui, scroll: pageScroll[name] } : ui];
        }),
      );
      return { ...pkg, pages };
    },
    hook(body: Record<string, unknown>, headers: Headers) {
      if (!bot.hook) return null;
      const answer = bot.hook(body, store, headers);
      save();
      return answer ?? { ok: true };
    },
    sync(device: string, ops: Op[], cursor: number, push?: string, phoneVersion?: number) {
      data.devices[device] = Date.now();
      // shortcut: a real server only posts to the relay it trusts, not to any URL a client sends
      if (push && /^https?:\/\/[^/\s]+\/push\/[\w-]+$/.test(push)) data.push[device] = push;
      else delete data.push[device]; // notifications off for this space on that phone
      if (cursor > data.seq) cursor = 0; // the server lost its data (or was reset): send everything again
      for (const o of ops) {
        if (data.seen.includes(o.id)) continue; // retries repeat op ids
        data.seen.push(o.id);
        if (o.op === "event") {
          bot.onEvent?.(o.table, o.row, store, device);
          continue;
        }
        if (o.op === "delete") delete table(o.table)[String(o.row.id)];
        else table(o.table)[String(o.row.id)] = { row: o.row, seq: ++data.seq, origin: device };
        bot.onOp?.(o, store, device);
      }
      bot.tick?.(store);
      // What changed since this device's cursor, written by the bot or by the user's other devices. Never its own rows.
      const pull: Record<string, Row[]> = {};
      for (const [t, rows] of Object.entries(data.rows)) {
        const fresh = Object.values(rows).filter((r) => r.origin !== device && r.seq > cursor).map((r) => r.row);
        if (fresh.length) pull[t] = fresh;
      }
      const notify = data.notes[device] ?? [];
      delete data.notes[device];
      save();
      // The current package version, so an open app updates the space without waiting for a restart.
      const { version } = JSON.parse(readFileSync(join(dir, "space.json"), "utf8")) as { version: number };
      // A phone on an older version may not have the columns these rows have yet: it updates first (it syncs again
      // right after), and gets everything from the same cursor then. Its changes were taken above either way.
      if (phoneVersion != null && phoneVersion < version) return { done: ops.map((o) => o.id), pull: {}, cursor, version, ...(notify.length ? { notify } : {}) };
      return { done: ops.map((o) => o.id), pull, cursor: data.seq, version, ...(notify.length ? { notify } : {}) };
    },
  };
}

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

/** Serves every space folder in `root`. With `token`, every request needs `Authorization: Bearer <token>`. */
export function createHandler(root: string, token?: string) {
  const spaces = new Map<string, ReturnType<typeof space>>();
  const get = (name: string) => {
    if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(root, name, "space.json"))) return null;
    if (!spaces.has(name)) spaces.set(name, space(join(root, name)));
    return spaces.get(name)!;
  };

  return async (req: Request): Promise<Response> => {
    if (token && req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
    const [, name = "", route = "", file = ""] = new URL(req.url).pathname.split("/");
    if (!name) return Response.json(readdirSync(root).filter((n) => get(n)));
    const s = get(name);
    if (!s) return new Response("no such space", { status: 404 });
    const body = new Uint8Array(await req.arrayBuffer());
    // the space's own access rule (auth.ts); hooks come from other services and check their caller in the bot
    if (route !== "hook") {
      const v = await checkAccess(join(root, name), s.auth(), req, body);
      if (!v.ok) return Response.json({ error: v.error }, { status: v.status });
    }
    const json = () => JSON.parse(new TextDecoder().decode(body) || "null");
    if (req.method === "GET" && route === "space") return Response.json(s.pkg());
    if (req.method === "POST" && route === "sync") {
      const { device, ops = [], cursor, push, version } = (json() ?? {}) as { device?: string; ops?: Op[]; cursor?: string | null; push?: string; version?: number };
      if (typeof device !== "string" || !device) return new Response("sync needs a device id", { status: 400 });
      return Response.json(s.sync(device, ops, Number(cursor ?? 0) || 0, typeof push === "string" ? push : undefined, typeof version === "number" ? version : undefined));
    }
    if (req.method === "POST" && route === "hook") {
      let payload: unknown = null;
      try { payload = json(); } catch {}
      if (!payload || typeof payload !== "object") return new Response("hook needs a JSON object", { status: 400 });
      const answer = s.hook(payload as Record<string, unknown>, req.headers);
      return answer === null ? new Response("this space has no hook", { status: 404 }) : Response.json(answer);
    }
    if (req.method === "GET" && route === "img" && /^[\w-]+\.(png|jpe?g|svg)$/.test(file)) {
      const path = join(root, name, "img", file);
      if (existsSync(path)) return new Response(readFileSync(path), { headers: { "Content-Type": TYPES[extname(file)] } });
    }
    return new Response("not found", { status: 404 });
  };
}

/** Starts an HTTP server for a handler: Bun.serve on Bun, node:http on Node. */
export async function serve(handler: (req: Request) => Promise<Response>, port = 8787): Promise<{ port: number; stop(): void }> {
  const B = (globalThis as { Bun?: { serve(o: object): { port: number; stop(): void } } }).Bun;
  if (B) return B.serve({ port, fetch: handler });
  const { createServer } = await import("node:http");
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks);
    const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]])) as [string, string][]);
    const r = await handler(new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(port, ok));
  return { port: (server.address() as { port: number }).port, stop: () => server.close() };
}

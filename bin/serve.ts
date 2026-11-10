#!/usr/bin/env bun
// Self-host spaces: chameloon-serve <folder with one sub-folder per space> [--port 8787] [--token secret]
// Every sub-folder with a space.json is served at /<name>; add "<your address>/<name>" in the app.
// For spaces with "auth": "device":
//   chameloon-serve invite  <folder> <space> [--uses 1] [--note "Anna's phone"]   a code to let one more phone in
//   chameloon-serve devices <folder> <space>                                      the phones that are in
//   chameloon-serve revoke  <folder> <space> <key or phone id prefix>            shut one phone out
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHandler, newInvite, readAuth, revoke, serve } from "../src/server.ts";

const args = process.argv.slice(2);
const command = ["invite", "devices", "revoke"].includes(args[0] ?? "") ? args.shift() : undefined;
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const port = Number(flag("port") ?? process.env.PORT ?? 8787);
const token = flag("token") ?? process.env.TOKEN;
const root = resolve(args[0] ?? process.env.SPACES ?? "spaces");
if (command) {
  const dir = join(root, args[1] ?? "");
  if (!args[1] || !existsSync(join(dir, "space.json"))) {
    console.error(`No space "${args[1] ?? ""}" in ${root}.`);
    process.exit(1);
  }
  if (command === "invite") {
    const uses = flag("uses");
    console.log(newInvite(dir, uses === "unlimited" ? null : Number(uses ?? 1), flag("note")));
  } else if (command === "devices") {
    for (const d of readAuth(dir).devices ?? []) console.log(`${d.key.slice(0, 16)}…  phone ${d.device ?? "?"}  since ${d.added}${d.note ? `  (${d.note})` : ""}`);
  } else {
    console.log(`revoked ${revoke(dir, args[2] ?? "\u0000")} phone(s)`);
  }
  process.exit(0);
}
if (!existsSync(root)) {
  console.error(`No folder ${root}. Usage: chameloon-serve <spaces folder> [--port 8787] [--token secret]`);
  process.exit(1);
}
const names = readdirSync(root).filter((n) => existsSync(join(root, n, "space.json")));
const server = await serve(createHandler(root, token), port);
console.log(`Serving ${names.length} space(s) from ${root} on port ${server.port}${token ? " (token required)" : ""}:`);
for (const n of names) console.log(`  /${n}`);

#!/usr/bin/env bun
// Checks a folder of spaces before you serve it: chameloon-check [folder] (default: the current folder).
// For each space: space.json against the schema (pages from pages/*.oui, as the server builds them), the migrations on a
// fresh database, and every SQL statement in the card, the widget and the pages, both on SQLite and against the app's
// own rules (one statement, no ATTACH/PRAGMA/sqlite_/_tables, Query only reads).
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SpacePackage } from "./src/space.ts";

// The same rules the Chameloon app applies before it runs any SQL.
const BLOCKED = /\b(attach|detach|pragma|vacuum|load_extension)\b|\bsqlite_|(^|[^A-Za-z0-9_])_[A-Za-z]/i;
const isRead = (s: string) => /^select\b/i.test(s) || (/^with\b/i.test(s) && !/\b(insert|update|delete|replace|create|drop|alter)\b/i.test(s));

function rule(sql: string, write: boolean): string | null {
  const s = sql.trim().replace(/;\s*$/, "");
  if (s.includes(";")) return "one statement at a time (build a ';' with char(59) inside strings)";
  if (BLOCKED.test(s)) return "not allowed in a space (ATTACH, PRAGMA, sqlite_*, _tables)";
  if (!write && !isRead(s)) return "a Query only reads; write with Mutation(\"run\", …)";
  return null;
}

const root = resolve(process.argv[2] ?? ".");
let bad = 0;
for (const dir of readdirSync(root).filter((d) => existsSync(join(root, d, "space.json"))).sort()) {
  const problems: string[] = [];
  const { pageScroll = {}, ...meta } = JSON.parse(readFileSync(join(root, dir, "space.json"), "utf8"));
  const pageFiles = existsSync(join(root, dir, "pages")) ? readdirSync(join(root, dir, "pages")).filter((f) => f.endsWith(".oui")) : [];
  const pages = Object.fromEntries(pageFiles.map((f) => {
    const ui = readFileSync(join(root, dir, "pages", f), "utf8");
    const n = basename(f, ".oui");
    return [n, pageScroll[n] ? { ui, scroll: pageScroll[n] } : ui];
  }));
  const parsed = SpacePackage.safeParse({ ...meta, pages });
  if (!parsed.success) for (const i of parsed.error.issues) problems.push(`${i.path.join(".") || "space.json"}: ${i.message}`);

  // migrations on a fresh database, then every statement against it
  const db = new Database(":memory:");
  let migrated = true;
  for (const [i, m] of (meta.schema ?? []).entries()) {
    const why = rule(m, true);
    if (why) problems.push(`schema[${i}]: ${why}`);
    try { db.run(m); } catch (e) { problems.push(`schema[${i}]: ${(e as Error).message}`); migrated = false; }
  }
  const statements: [string, string, boolean][] = [];
  if (meta.card?.query) statements.push(["card.query", meta.card.query, false]);
  if (meta.card?.chart) statements.push(["card.chart", meta.card.chart, false]);
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "query" && typeof x === "string" ? statements.push([`${at}.query`, x, false]) : walk(x, `${at}.${k}`);
  };
  walk(meta.widget, "widget");
  for (const f of pageFiles) {
    for (const [n, line] of readFileSync(join(root, dir, "pages", f), "utf8").split("\n").entries()) {
      const write = /Mutation\("run"/.test(line);
      for (const m of line.matchAll(/sql: "((?:[^"\\]|\\.)*)"/g)) statements.push([`${f}:${n + 1}`, JSON.parse(`"${m[1]}"`), write]);
    }
  }
  for (const [at, sql, write] of statements) {
    const why = rule(sql, write);
    if (why) problems.push(`${at}: ${why}`);
    else if (migrated) try { db.prepare(sql); } catch (e) { problems.push(`${at}: ${(e as Error).message}`); }
  }

  if (problems.length === 0) console.log(`ok   ${dir} (${statements.length} statements)`);
  else {
    bad++;
    console.log(`FAIL ${dir}`);
    for (const p of problems) console.log(`  ${p}`);
  }
}
process.exit(bad ? 1 : 0);

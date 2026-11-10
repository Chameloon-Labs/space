---
name: chameloon-space
description: Write, change or check a Chameloon space (a small iPhone app made of space.json plus OpenUI Lang pages, with its data in SQLite on the phone). Use when asked to build a mini app, tracker, list or dashboard for Chameloon, to edit a space.json or pages/*.oui file, to add a card or widget to a space, or to fix what `chameloon-check` reports.
---

# Chameloon space

A space is a folder:

```
<space>/
  space.json       name, version, icon, tint, permissions, schema (SQL migrations), sync, theme, card, widget
  pages/home.oui   one OpenUI Lang file per page; `home` opens first
  img/…            pictures (PNG, JPEG, SVG) used as "/img/x.png"
  bot.ts           optional server-side logic (onOp, onEvent, tick, hook)
```

Before writing, read the full format: https://chameloon.com/llms-full.txt (all docs as Markdown) and
https://chameloon.com/space.schema.json (JSON Schema of space.json). Working examples: every space in
https://chameloon.com/spaces/ shows its files; `showcase` uses every component and widget node. Tools come from the
public package: `bun add @chameloon-labs/space`.

## Rules

1. Put `"$schema"` first in space.json. `name` and `version` are required.
2. Raise `version` with every change. `schema` is append-only: never edit or remove a migration that shipped; add an
   `ALTER TABLE` instead and give new columns defaults.
3. Pages: one statement per line, `root = Page([...])` first. `Query("query", {sql, params})` is SELECT only;
   writes are `Mutation("run", {sql, params})`. Only this space's tables; no ATTACH, no PRAGMA.
4. Generate ids in SQL: `lower(hex(randomblob(8)))`.
5. Every phone feature a page calls must be in `permissions`: `photo` → camera/photos, `file` → files, `location` →
   location, `notify` → notifications. `send` and `sync` need `sync` in space.json.
6. Pages have no network. Pictures are `/img/…` files next to space.json or `data:` URIs.
7. Only `Input`, `TextArea` and `Chips` bind to `$variables`. `@Navigate("page", {id: x})` makes `$id` on that page.
8. Leave out `sync` unless the user wants data on a server; then list only the tables that must leave the phone.
9. Card and widget queries run on the phone's data; their first row fills `{{column}}`.

## Check, then hand over

Run `bunx chameloon-check <folder>` and fix every line it prints until each space says `ok`. Serve with
`bunx chameloon-serve <folder> --port 8787`; the user adds `<host>:8787/<space>` in the app.

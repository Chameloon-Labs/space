# @chameloon-labs/space

Everything to build and host Chameloon spaces, in TypeScript/JavaScript:

| Import | What |
|---|---|
| `@chameloon-labs/space` | `SpacePackage` (zod schema + type of `space.json`), `WidgetNode`, the tool types pages call (`tools.ts`), the sync protocol types |
| `@chameloon-labs/space/server` | `createHandler(folder, token?)` (serves a folder of spaces), `serve(handler, port)` (Bun or Node), the `Bot` types for `bot.ts` |
| `@chameloon-labs/space/space.schema.json` | JSON Schema for editors (`"$schema"` in space.json) |
| `chameloon-serve <folder>` | the server as a command (also: the `Dockerfile` in this package) |
| `chameloon-check [folder]` | checks every space in a folder (default: the current one) before you serve it |

Docs: [Quick start](https://chameloon.com/docs/quick-start/) · [space.json](https://chameloon.com/docs/space-json/) · [Components](https://chameloon.com/docs/components/) · [Hosting](https://chameloon.com/docs/hosting/) · [CLI](https://chameloon.com/docs/cli/) · [For AI agents](https://chameloon.com/llms.txt)

```ts
import { SpacePackage } from "@chameloon-labs/space";
import { createHandler, serve } from "@chameloon-labs/space/server";

await serve(createHandler("my-spaces", process.env.TOKEN), 8787);
// what the app will get, checked the way the app checks it (throws with what's wrong):
SpacePackage.parse(await (await fetch("http://localhost:8787/todo/space")).json());
```

## What a space is

A space is a `space.json` plus one OpenUI Lang page per file in `pages/*.oui`. A server serves it at `GET <url>/space`
(pages merged into `pages`, `home` required). The phone keeps the space's data in its own SQLite file.

## Fields (`src/space.ts`)

| Field | Meaning |
|---|---|
| `name`, `version` | Required. Bump `version` to update installed copies. |
| `description`, `icon`, `tint` | List line (max 140), icon name, `#RRGGBB`. |
| `immersive` | Open without the top bar. Default false. |
| `permissions` | `camera`, `photos`, `files`, `location`, `notifications`. Default none. |
| `schema` | Ordered SQL migrations; only new entries run on update. |
| `pages` | Page name to OpenUI source, or `{ui, scroll: "top" \| "bottom"}`. |
| `sync` | `{tables, every?}`: changes to `tables` go to `POST <url>/sync`; `every` = seconds (min 5). |
| `card` | See below. |

## Card

What the space's home-screen card and widget show, computed on the phone from the space's SQLite file.

- `query`: one SELECT; its first row fills `{{column}}` in `motd` and `stats`.
- `motd`: one line of inline markdown, e.g. `**{{open}}** todos waiting` (max 200).
- `stats`: up to 4 `{label (max 20), value}`; value is a template like `{{open}}`.
- `chart`: one SELECT of exactly one numeric column; one value per row, oldest first, drawn as a trend line.

## Tools (`src/tools.ts`)

Called from pages with `Query("tool", args)` / `Mutation("tool", args)`.

| Tool | Args | Result |
|---|---|---|
| `query` | `{sql, params?}` | `{rows}` |
| `run` | `{sql, params?}` | `{changes, lastId}` |
| `sync` | `{}` | `{sent, pulled, version}` |
| `photo` | `{source: "camera" \| "library"}` | `{uri, width, height}` |
| `file` | `{types?: string[]}` | `{name, type, size, uri}` |
| `location` | `{}` | `{lat, lon, accuracy}` |
| `notify` | `{title?, body?, in?, at?}` | `{id}` |

Page actions: `Navigate {page, params?}`, `Back`, `OpenMaps {lat, lon, label}`, `Share {name, uri}`.

## Sync protocol

`POST <url>/sync` with `SyncRequest {device, ops: [{id, op: "upsert" | "delete", table, row, at}], cursor, push?}`
answers `SyncResponse {done, pull, cursor?, notify?, version?}`. `done` lists stored op ids (ids repeat on retries),
`pull` is `{table: rows[]}` changed by others, `cursor` is sent back next time.

## Use

```json
{ "$schema": "./node_modules/@chameloon-labs/space/space.schema.json", "name": "My space", ... }
```

Or `https://chameloon.com/space.schema.json`. Check your spaces with `bunx chameloon-check my-spaces`; serve them with
`bunx chameloon-serve my-spaces --port 8787`. Both need [Bun](https://bun.sh).

## Look, pictures and widgets

- `theme`: `preset` (`glow`, `paper`, `playful`, `bold`, `terminal`, `minimal`), `font` (`system`, `serif`, `rounded`, `mono`),
  `radius` (0–32), `appearance` (`auto`, `light`, `dark`), `background` (an image path on the space's server).
- Pictures: any image path on the space's server (`/img/hero.svg`, PNG, JPEG, SVG) works in `Hero` (as its art, in place of
  the emoji), `Tile`, `Row` (leading), `Image`, `Gallery`, and markdown (`![](/img/x.png)`). The app loads them with the
  space's token; the page itself never reaches the network. `Tiles([Tile(title, subtitle, image, badge, action)], columns)`
  is a picture-first grid; `Metric(value, label, caption, trend)` is one big number without a banner.
- `icon`: a [Regen icon](https://github.com/kazdenc/regen-icons/tree/main/svg/outline) name (`list-check`) or a PNG/JPEG path on the space's server (`/img/icon.png`), used
  on the home screen, in the widget and in the app's sheets.
- `widget`: the space's own home and lock screen widgets. `query` runs on the space's data and fills `{{column}}` in every
  text and number; `small`, `medium`, `large`, `circular`, `rectangular`, `inline` each hold a tree of nodes:
  `stack` (axis vertical/horizontal/z), `text`, `metric`, `icon` (SF Symbol), `image` (PNG/JPEG), `gauge`, `progress`
  (0–1), `chart` (its own `query` returning label, value, series), `date` (ticking timers), `button` (opens a page), `spacer`,
  `divider`. Sizes left out show the card. The [Showcase space](https://chameloon.com/spaces/showcase/) uses every node.

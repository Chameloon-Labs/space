/** Tools a page calls with OpenUI `Query("tool", args)` / `Mutation("tool", args)`. They see only this space's database. */
export interface Tools {
  /** Query("query", {sql: "SELECT ...", params: [...]}) */
  query: { args: { sql: string; params?: unknown[] }; result: { rows: Record<string, unknown>[] } };
  /** Mutation("run", {sql, params}). Changes to synced tables go to the server right after. */
  run: { args: { sql: string; params?: unknown[] }; result: { changes: number; lastId: number } };
  /** Mutation("send", {event, data}): a message for the space's server (bot.ts onEvent), queued like a change. Needs `sync`. */
  send: { args: { event: string; data?: unknown }; result: { queued: true } };
  /** Mutation("sync", {}) */
  sync: { args: {}; result: { sent: number; pulled: number; version: number } };
  /** Mutation("photo", {source}). Needs permission "camera" or "photos". uri is a data URI. */
  photo: { args: { source: "camera" | "library" }; result: { uri: string; width: number; height: number } };
  /** Mutation("file", {types: ["application/pdf"]}). Needs permission "files". uri is a data URI. */
  file: { args: { types?: string[] }; result: { name: string; type: string; size: number; uri: string } };
  /** Mutation("location", {}). Needs permission "location". */
  location: { args: {}; result: { lat: number; lon: number; accuracy: number } };
  /** Mutation("notify", {title, body, in: 3600}): now, `in` seconds, or `at` an ISO time. Needs permission "notifications". */
  notify: { args: { title?: string; body?: string; in?: number; at?: string }; result: { id: string } };
}

/** One recorded change to a synced table, or (op "event") a message from Mutation("send"): `table` is the event name,
 *  `row` its data. Ids repeat on retries. */
export interface SyncOp {
  id: string;
  op: "upsert" | "delete" | "event";
  table: string;
  row: { id: string; [column: string]: unknown };
  /** ISO time of the change. */
  at: string;
}

/** POST <space url>/sync request. `device` is this phone's ID for this space. */
export interface SyncRequest {
  /** The space version the phone runs. Older than the server's: it gets no rows yet, only `version`, updates, and syncs again. */
  version?: number;
  device: string;
  ops: SyncOp[];
  /** Whatever the server returned last time, so it can send only what's new. */
  cursor: string | number | null;
  /** Relay URL for pushing notifications; omitted when notifications are off. */
  push?: string;
}

/** POST <space url>/sync response. Failures keep the phone's queue. */
export interface SyncResponse {
  /** Ids of the ops the server stored. */
  done: string[];
  /** Rows to store, per table. */
  pull: Record<string, { id: string; [column: string]: unknown }[]>;
  cursor?: string | number;
  notify?: { title: string; body: string }[];
  /** The current package version, so an open app updates the space. */
  version?: number;
}

/** Page actions the renderer posts to the app. */
export type PageAction =
  | { type: "Navigate"; params: { page: string; params?: Record<string, unknown> } }
  | { type: "Back" }
  | { type: "OpenMaps"; params: { lat: number; lon: number; label: string } }
  | { type: "Share"; params: { name: string; uri: string } };

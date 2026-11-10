import { z } from "zod";

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);

/** A page: OpenUI Lang source, or {ui, scroll: "bottom"} for pages read from the end (chats). */
const Page = z.union([z.string(), z.object({ ui: z.string(), scroll: z.enum(["top", "bottom"]).default("top") })]);
export const pageSource = (p: z.infer<typeof Page> | undefined) => (p == null ? undefined : typeof p === "string" ? { ui: p, scroll: "top" as const } : p);

/** A number, or a template like "{{ratio}}" that the widget's query fills in. */
const Num = z.union([z.number(), z.string()]);

/** One piece of a widget. `stack` holds children; the rest draw something. Every string can use {{column}}. */
export type WidgetNode = {
  type: "stack" | "text" | "metric" | "icon" | "image" | "gauge" | "progress" | "chart" | "date" | "button" | "spacer" | "divider";
  text?: string; detail?: string; badge?: string; style?: string; icon?: string; tint?: string; url?: string; navigate?: string;
  value?: number | string; min?: number | string; max?: number | string; date?: string; query?: string;
  axis?: "vertical" | "horizontal" | "z"; align?: string; spacing?: number | string; padding?: number | string; radius?: number | string;
  background?: string; height?: number | string; children?: WidgetNode[];
};
export const WidgetNode: z.ZodType<WidgetNode> = z.lazy(() =>
  z.object({
    type: z.enum(["stack", "text", "metric", "icon", "image", "gauge", "progress", "chart", "date", "button", "spacer", "divider"]),
    /** text/metric: the words or the number. button: the label. */
    text: z.string().optional(),
    /** metric: a line under the number. date: the font. */
    detail: z.string().optional(),
    /** gauge: the value shown inside. */
    badge: z.string().optional(),
    /** text: hero, largeTitle, title…caption2. date: timer, relative, offset, time, date. gauge: circular, capacity, linear. image: fit, fill. chart: bar, line, area. */
    style: z.string().optional(),
    /** An SF Symbol name. */
    icon: z.string().optional(),
    /** "#RRGGBB". */
    tint: z.string().optional(),
    /** image: a PNG or JPEG path on the space's server. */
    url: z.string().optional(),
    /** A page this node opens (a button needs one). */
    navigate: z.string().optional(),
    value: Num.optional(),
    min: Num.optional(),
    max: Num.optional(),
    /** date: an ISO 8601 time; WidgetKit keeps timers ticking without reloads. */
    date: z.string().optional(),
    /** chart: one SELECT returning label, value (and optional series) per row. */
    query: z.string().optional(),
    axis: z.enum(["vertical", "horizontal", "z"]).optional(),
    /** leading, center, trailing (top, bottom in a horizontal stack). */
    align: z.string().optional(),
    spacing: Num.optional(),
    padding: Num.optional(),
    radius: Num.optional(),
    background: z.string().optional(),
    height: Num.optional(),
    children: z.array(WidgetNode).optional(),
  }),
);

/** What GET <space url>/space returns. Validated on arrival: it comes from someone else's server. */
export const SpacePackage = z.object({
  /** Lets editors validate a space.json against the JSON Schema. Ignored by the app. */
  $schema: z.string().optional(),
  name: z.string().min(1).max(60),
  version: z.number().int(),
  /** The oldest Chameloon app this version works with, e.g. "1.2" (it uses newer components or widget nodes). */
  minApp: z.string().regex(/^\d+(\.\d+){0,2}$/).optional(),
  /** What this version changed, shown on the space's card after it updates ("Now with priorities"). */
  changes: z.string().max(200).optional(),
  /** One line under the name in the space list. */
  description: z.string().max(140).optional(),
  /** A Regen icon name ("list-check", https://github.com/kazdenc/regen-icons/tree/main/svg/outline), or a PNG/JPEG path on the space's server ("/img/icon.png") used as the app icon. */
  icon: z.string().optional(),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Opens without the top bar (swipe from the left edge to go back). The user can change it per space. */
  immersive: z.boolean().default(false),
  /** Native features the pages may use. Shown before install; anything not listed is refused. */
  permissions: z.array(z.enum(["camera", "photos", "files", "location", "notifications"])).default([]),
  /** Ordered migrations for the space's own SQLite file; only new entries run on update. */
  schema: z.array(z.string()).default([]),
  /** OpenUI Lang per page. "home" opens first. */
  pages: z.record(z.string(), Page).refine((p) => "home" in p, "pages.home is required"),
  /**
   * Omit for a local-only space. Every insert, update and delete on `tables` is sent to
   * POST <url>/sync; `every` also syncs at that interval (seconds) while the space is open.
   */
  sync: z.object({ tables: z.array(name).default([]), every: z.number().min(5).optional() }).optional(),
  /** What the space's card on the home screen and its home-screen widget show, computed on the phone from the space's own SQLite file. */
  card: z
    .object({
      /** One SELECT; the first row's columns fill {{column}} in motd and stats. */
      query: z.string().optional(),
      /** One line of inline markdown, e.g. "**{{open}}** todos waiting". */
      motd: z.string().max(200).optional(),
      /** Up to 4 figures. `value` is a template like "{{open}}". */
      stats: z.array(z.object({ label: z.string().max(20), value: z.string() })).max(4).optional(),
      /** One SELECT of exactly one numeric column: one value per row, oldest first, drawn as a small trend line. */
      chart: z.string().optional(),
    })
    .optional(),
  /**
   * Who may reach the space's server: "open" (anyone with the address), "token" (one shared secret), or "device" (each
   * phone signs every request with its own key and comes in once with an invite code; see docs/self-hosting.md).
   */
  auth: z.enum(["open", "token", "device"]).default("open"),
  /** The space's own look for its pages. */
  theme: z
    .object({
      /** glow (default: tinted banner and glow), paper (editorial), playful (rounded, pastel), bold (athletic), terminal (console), minimal (quiet). */
      preset: z.enum(["glow", "paper", "playful", "bold", "terminal", "minimal"]).default("glow"),
      font: z.enum(["system", "serif", "rounded", "mono"]).optional(),
      /** Corner radius in points, 0-32. */
      radius: z.number().min(0).max(32).optional(),
      /** Always light or dark, whatever the phone is set to. */
      appearance: z.enum(["auto", "light", "dark"]).default("auto"),
      /** An image on the space's server behind every page, e.g. "/img/bg.svg". */
      background: z.string().regex(/^\/[^/]/).optional(),
    })
    .optional(),
  /**
   * Home and lock screen widgets the space designs itself, per size. `query` runs on the space's own data; its first
   * row fills {{column}} in any text or number. Sizes it leaves out show the card.
   */
  widget: z
    .object({
      query: z.string().optional(),
      /** "#RRGGBB" or "#RRGGBB,#RRGGBB" (a gradient). Default: a wash of the space's tint. */
      background: z.string().optional(),
      /** Text and controls for a dark or light background. */
      scheme: z.enum(["dark", "light"]).optional(),
      /** The page a tap opens. */
      navigate: z.string().optional(),
      small: z.array(z.lazy(() => WidgetNode)).optional(),
      medium: z.array(z.lazy(() => WidgetNode)).optional(),
      large: z.array(z.lazy(() => WidgetNode)).optional(),
      circular: z.array(z.lazy(() => WidgetNode)).optional(),
      rectangular: z.array(z.lazy(() => WidgetNode)).optional(),
      inline: z.array(z.lazy(() => WidgetNode)).optional(),
    })
    .optional(),
});
export type SpacePackage = z.infer<typeof SpacePackage>;
export type Permission = SpacePackage["permissions"][number];

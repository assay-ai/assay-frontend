import { DEMO_FIXTURES, type DemoFixture } from "./fixtures";

/**
 * The demo data layer — DEMO ONLY, and dead code unless
 * `NEXT_PUBLIC_DEMO_CHAINS=robinhood` was inlined at build time.
 *
 * ## Why this exists
 *
 * A backend older than this frontend, or one whose database was never
 * seeded, behaves like this: `GET /chains` 404s, the catalogue answers zero providers, and a
 * fresh org has no balance, no calls and no receipts. Every screen is
 * therefore correct AND empty, which is the one thing a demo cannot be.
 *
 * ## What it is allowed to do
 *
 * Two moves, both keyed on the request path:
 *
 *  - **fill** — the API answered, but with nothing (an empty list, a missing
 *    object). The fixture is substituted so the screen has something to draw.
 *  - **stand in** — the API failed (404 on a route this deployment predates,
 *    or a 5xx). The fixture is returned as though it had succeeded.
 *
 * It never edits a non-empty answer. A real figure from the real API always
 * wins, so anything the backend genuinely serves is what the screen shows.
 *
 * ## What it must not become
 *
 * This is a stage set, not a mock backend. It has no state, nothing writes to
 * it, and two identical calls return the same rows. Do not teach it to
 * remember a deposit or to decrement a balance — that is a mock server, and a
 * mock server is a thing people start trusting. It can be deleted whole once every
 * environment runs a seeded multichain backend.
 */

/**
 * Whether this build carries the demo data layer at all — **the env flag and
 * nothing else**.
 *
 * An earlier version also switched on by hostname. That was removed: the
 * fixtures answer GETs BEFORE the network, so leaving it on would show
 * invented balances and deposits over a live chain — on exactly the hosts
 * where the real flow has to be checked.
 */
export function demoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_CHAINS === "robinhood";
}

/**
 * The path as the fixture table spells it: no base URL, no query string, and
 * no leading slash difference between `/balances` and `balances`.
 */
function normalise(url: string | undefined): string {
  if (!url) return "";
  const withoutQuery = url.split("?")[0];
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

function matchFixture(method: string, path: string): DemoFixture | null {
  const verb = method.toUpperCase();
  for (const fixture of DEMO_FIXTURES) {
    if (fixture.method !== verb) continue;
    if (fixture.match instanceof RegExp ? fixture.match.test(path) : fixture.match === path) {
      return fixture;
    }
  }
  return null;
}

/**
 * The canned body for this request, or `undefined` when the demo has nothing
 * to say about it — in which case the caller does the real request.
 *
 * Every fixture short-circuits: with the flag on, a path in the table never
 * reaches the network. That is what makes the demo instant and immune to the
 * dev API being slow, unseeded, or missing the route entirely. Paths with no
 * fixture are untouched, which is how the live demo page still makes two real
 * calls against real tools.
 */
export function demoResponse(
  method: string | undefined,
  url: string | undefined,
  params?: Record<string, unknown>,
  data?: unknown,
): unknown {
  if (!demoEnabled()) return undefined;
  const fixture = matchFixture(method ?? "GET", normalise(url));
  if (fixture === null) return undefined;
  /*
    `body` is given the path AND the query, because several screens ask one
    route four different questions — `/receipts/summary` answers a day, a week
    and a month from the same path, and a fixture blind to `groupBy` prints the
    same three totals under three different headings, which is the kind of
    detail a viewer notices.
  */
  /*
    A write's body is handed over too, so a stand-in can ECHO what was sent —
    a new draft answers as the tool that was picked, not as some other one.
    Echoing is not remembering: nothing is kept between calls.
  */
  return fixture.body(normalise(url), params ?? queryOf(url), bodyOf(data));
}

/** A request body as a plain object, whether it was sent as one or as JSON text. */
function bodyOf(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

/** The query string as a plain object, for a caller that sent one in the URL. */
function queryOf(url: string | undefined): Record<string, string> {
  const query = (url ?? "").split("?")[1];
  if (query === undefined) return {};
  return Object.fromEntries(new URLSearchParams(query).entries());
}


/**
 * How a binding is named on screen, until the API can name it properly.
 *
 * The design labels every binding row with the tool's slug — `ais_lookup`,
 * `search_web`. `GET /providers/me/tool-bindings` returns `toolId` as a bare
 * UUID and the detail route adds nothing, so the endpoint's host stands in as
 * the only human-readable identifier those two responses carry.
 *
 * **The tool name has since landed.** `GET
 * /providers/me/tool-bindings/catalogue` returns every tool's `name`,
 * `description` and both schemas, and `/provider/bindings` already joins on it
 * to render real names. So this function is no longer the whole answer — it is
 * the *fallback*, for a caller that has no catalogue in hand, and for the real
 * case of a binding whose `toolId` is not in the catalogue at all (the
 * catalogue is seeded from a file and can change under a stored binding).
 *
 * What is left is not a swap but a fetch: a caller that wants the name has to
 * hold the catalogue query. See the console layout, which still shows hosts.
 *
 * This lives here, in one place, on purpose. It was written in the console
 * layout with a comment saying "swap this one function the day a tool name
 * lands" — and then four screens copied it, because the layout is private to
 * its route group and screen authors could not import it. Five copies is the
 * exact opposite of what that comment was for.
 *
 * So: when a tool name lands, change this function and nothing else.
 *
 * It returns a domain name only: an IP address, a local host or anything that
 * does not parse reads "self-hosted endpoint", and a port is never shown.
 */
export function labelForEndpoint(endpoint: string): string {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    return SELF_HOSTED;
  }
  return isNamedPublicHost(hostname) ? hostname : SELF_HOSTED;
}

/** What a listing shows instead of an IP address or a local name. */
export const SELF_HOSTED = "self-hosted endpoint";

/**
 * A domain name worth showing: not an IP literal (v4 or bracketed v6), not
 * `localhost`, not a single label. The port is never shown either, so a list
 * row never reads like infrastructure (`[2001:db8::1]:4010`); the full address
 * stays in the listing's Settings → Connection.
 */
function isNamedPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host.startsWith("[") || host.includes(":")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return host.includes(".");
}

/**
 * A binding id, shortened for display.
 *
 * The design writes `bnd_7QK`; the wire gives a bare UUID and there is no
 * short-ref form anywhere in the API, so screens show a truncated uuid rather
 * than invent a `bnd_` prefix the platform does not issue. Always pair it with
 * the full id somewhere copyable.
 */
export function shortBindingId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

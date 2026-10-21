import { parse } from "tldts";

/**
 * The registrable domain (eTLD+1) of a host, from the Public Suffix List with
 * its private section, so `foo.github.io` is its own site rather than
 * `github.io`. The same rule as the backend's `registrableDomain` (spec
 * §6.3.5, R-OA-25), which fills `client.registrableDomain` for a URL client.
 *
 * IDNs come back as punycode, so a look-alike Unicode name is shown as what it
 * really is. `null` for anything that is not a DNS name under a listed public
 * suffix: IP literals, single labels, `localhost`, unlisted TLDs, a public
 * suffix on its own, a trailing dot.
 */
export interface RegistrableDomain {
  /** eTLD+1, lowercase ASCII. */
  readonly registrable: string;
  /** The full host, lowercase ASCII. */
  readonly host: string;
}

const ASCII_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function registrableDomain(host: string): RegistrableDomain | null {
  if (typeof host !== "string" || host === "" || host.endsWith(".")) return null;
  // The URL parser would quietly drop a port, a path or userinfo; refuse them instead.
  if (/[\s/\\:@?#[\]%]/.test(host)) return null;
  let ascii: string;
  try {
    // Lowercases and applies UTS #46 (punycode), as `domainToASCII` does on the backend.
    ascii = new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
  if (!ascii || !ASCII_HOST_RE.test(ascii)) return null;
  const parsed = parse(ascii, { allowPrivateDomains: true });
  if (parsed.isIp !== false || !parsed.domain) return null;
  if (!parsed.isIcann && !parsed.isPrivate) return null;
  return { registrable: parsed.domain, host: ascii };
}

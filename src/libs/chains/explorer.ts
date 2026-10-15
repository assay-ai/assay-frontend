import type { Chain } from "@/interfaces/chain";

/**
 * Explorer links, built from what `GET /chains` served — never from a
 * hardcoded host and never from a template literal.
 *
 * **`explorerBaseUrl` can carry a query string.** The Solana devnet explorer's
 * base is `https://explorer.solana.com/?cluster=devnet`, so
 * `` `${base}/tx/${ref}` `` produces `.../?cluster=devnet/tx/5Yx…` — a URL
 * that resolves to the explorer's home page and reads, to whoever clicked it,
 * as a receipt link that is simply broken. `URL` is what keeps the query where
 * it belongs while the path grows.
 *
 * Both namespaces use `/tx/` and `/address/`, so nothing here branches on the
 * namespace. If a future chain's explorer does not, it gets its path from the
 * API rather than an `if` here.
 *
 * **Only http(s).** The base is served by the API, and `new URL("javascript:…")`
 * ignores the pathname setter, so a hostile base would stay a `javascript:`
 * href (frontend review 2026-10-15, F5). Anything else gives no link.
 */
function explorerUrl(chain: Chain, segment: "tx" | "address", value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(chain.explorerBaseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const base = url.pathname.replace(/\/$/, "");
  url.pathname = `${base}/${segment}/${encodeURIComponent(value)}`;
  return url.toString();
}

/** A link to one transaction, by whatever this chain calls a reference. */
export function explorerTxUrl(chain: Chain, ref: string): string | undefined {
  return explorerUrl(chain, "tx", ref);
}

/** A link to one account. */
export function explorerAddressUrl(chain: Chain, address: string): string | undefined {
  return explorerUrl(chain, "address", address);
}

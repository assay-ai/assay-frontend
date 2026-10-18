/**
 * A money field's unit. A dollar stablecoin (USDG on Robinhood Chain, USDC…)
 * shows as "$", the unit the rest of the app uses, with a tooltip naming the
 * coin, rather than a second unit name the person has to translate. Any other
 * asset shows its own symbol: it is never given a dollar sign it does not
 * have. The list mirrors the backend's (`USD_PEGGED_SYMBOLS` in
 * `mcp-catalogue.service.ts`).
 */
const DOLLAR_STABLECOINS: ReadonlySet<string> = new Set(["USDC", "USDG", "USDT", "PYUSD"]);

/** The unit to show: "$" for plain dollars and dollar stablecoins, else the symbol itself. */
export function dollarUnitText(symbol: string | null | undefined): string {
  const coin = symbol?.trim().toUpperCase();
  if (!coin || coin === "USD" || DOLLAR_STABLECOINS.has(coin)) return "$";
  return symbol!.trim();
}

/** The tooltip for a dollar stablecoin; null for plain dollars or any other asset. */
export function dollarUnitNote(symbol: string | null | undefined): string | null {
  const coin = symbol?.trim();
  if (!coin || !DOLLAR_STABLECOINS.has(coin.toUpperCase())) return null;
  return `${coin} is a dollar stablecoin: 1 ${coin} = $1`;
}

export function DollarUnit({ symbol }: { symbol?: string | null }) {
  const note = dollarUnitNote(symbol);
  if (!note) return <>{dollarUnitText(symbol)}</>;
  return (
    <span title={note} data-testid="dollar-unit">
      $<span className="sr-only"> ({note})</span>
    </span>
  );
}

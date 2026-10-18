/**
 * A money field's unit: always "$", the unit the rest of the app uses. When
 * the balance is held in a dollar stablecoin (USDG on Robinhood Chain), the
 * "$" carries a tooltip saying so, rather than a second unit name the person
 * has to translate.
 */
export function dollarUnitNote(symbol: string | null | undefined): string | null {
  const coin = symbol?.trim();
  if (!coin || coin.toUpperCase() === "USD") return null;
  return `${coin} is a dollar stablecoin: 1 ${coin} = $1`;
}

export function DollarUnit({ symbol }: { symbol?: string | null }) {
  const note = dollarUnitNote(symbol);
  if (!note) return <>$</>;
  return (
    <span title={note} data-testid="dollar-unit">
      $<span className="sr-only"> ({note})</span>
    </span>
  );
}

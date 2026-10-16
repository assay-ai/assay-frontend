import { DEMO_ASSET, minutesAgo } from "./fixtures";

/**
 * DEMO ONLY: the per-call CSV (`GET /providers/me/calls/export`). It cannot
 * sit in the fixture table, because that route bypasses the JSON envelope
 * (`api.raw()`) and so never reaches the demo layer; `exportProviderCalls`
 * asks for this directly when the demo flag is on.
 *
 * Consistent with the demo earnings: four market-quote calls not credited
 * ($1.62 in total), one waiting on the buyer ($0.405), one never collected
 * ($0.405), one fx-rates call forfeited ($0.072), the rest settled. Like the
 * real export, written-off and forfeited rows carry 0 provider amount and fee.
 */
const HEADER =
  "call_id,intent_id,created_at,tool_id,status,classification,reason,verification_verdict,provider_amount,platform_fee,price_amount,asset,decimals";

type Row = [tool: string, status: string, classification: string, reason: string, verdict: string, provider: string, fee: string, price: string];

const ROWS: Row[] = [
  ["market-quote", "SETTLED", "PAID_CREDITED", "verification: judged and settled by the worker", "PASS", "360000", "40000", "400000"],
  ["market-quote", "SETTLED", "PAID_CREDITED", "verification: judged and settled by the worker", "PASS", "360000", "40000", "400000"],
  ["fx-rates", "SETTLED", "PAID_CREDITED", "verification: judged and settled by the worker", "PASS", "72000", "8000", "80000"],
  ["market-quote", "REFUNDED", "PAID_UNCREDITED", "verification: judged and refunded by the worker", "FAIL", "405000", "45000", "450000"],
  ["market-quote", "REFUNDED", "PAID_UNCREDITED", "verification: judged and refunded by the worker", "FAIL", "405000", "45000", "450000"],
  ["market-quote", "VOIDED", "SYSTEM_ERROR", "mcp: provider outcome was not a DATA_RESULT", "", "405000", "45000", "450000"],
  ["market-quote", "VOIDED", "REQUEST_ERROR", "mcp: provider outcome was not a DATA_RESULT", "", "405000", "45000", "450000"],
  ["chain-activity", "SETTLED", "FREE", "verification: judged and settled by the worker", "PASS", "0", "0", "0"],
  ["fx-rates", "SETTLED", "PAID_CREDITED", "verification: judged and settled by the worker", "PASS", "72000", "8000", "80000"],
  ["market-quote", "VERIFYING", "PENDING", "mcp: forwarded to asynchronous verification", "", "360000", "40000", "400000"],
  ["market-quote", "SETTLED", "PAID_BUYER_DEBT", "buyer_debt:EscrowInsufficient", "PASS", "405000", "45000", "450000"],
  ["market-quote", "SETTLED", "PAID_UNCOLLECTED", "uncollected:VoucherExpired", "PASS", "0", "0", "450000"],
  ["fx-rates", "SETTLED", "PROVIDER_FORFEITED", "provider_forfeit:ProviderBelowMinimumStake", "PASS", "0", "0", "80000"],
];

export function demoCallsCsv(): string {
  const lines = ROWS.map(([tool, status, classification, reason, verdict, provider, fee, price], index) => {
    const id = `01J9DEMO${String(index).padStart(4, "0")}`;
    return [
      `call_${id}`,
      `int_${id}`,
      minutesAgo(30 + index * 95),
      tool,
      status,
      classification,
      `"${reason}"`,
      verdict,
      provider,
      fee,
      price,
      DEMO_ASSET,
      "6",
    ].join(",");
  });
  return [HEADER, ...lines].join("\n");
}

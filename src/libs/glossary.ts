/**
 * The product's glossary: one plain sentence per term a person meets on a
 * screen. `<Term k="escrow">escrow</Term>` (components/patterns/term.tsx)
 * reads from here, so a definition is written once and reads the same on every
 * screen that uses the word.
 *
 * Rules for an entry:
 *  - one sentence, no jargon inside the definition of jargon;
 *  - say what it means for the reader's money or work, not how it is built;
 *  - no roadmap, no internal names, no codes.
 *
 * The shared vocabulary (FIX-PLAN 2026-10-18 §2) lives here too: Reserved,
 * Refundable until, Report a bad result, Not charged, Failure rate, Agent
 * limit vs Account ceiling. The stake rule and the worked penalty example are
 * built from the same constants the provider screens use, so they cannot
 * drift from them.
 */

import { DAILY_CAP_PERCENT } from "@/features/explorer/provider-economics";
import { PENALTY_MULTIPLIER } from "@/features/provider-penalties/estimate";
import { MIN_CHECKED_CALLS } from "@/features/provider-sla/reading";

/**
 * The worked example's inputs: a $0.10 tool that promised at most 3% failures
 * and failed 12% of 1,000 paid calls in one window. The penalty is the
 * backend's formula (`estimatePenalty`): calls × price × (observed − promised)
 * × multiplier.
 */
const EXAMPLE = { price: 0.1, calls: 1000, promised: 0.03, observed: 0.12 } as const;
const EXAMPLE_PENALTY = (
  EXAMPLE.calls * EXAMPLE.price * (EXAMPLE.observed - EXAMPLE.promised) * PENALTY_MULTIPLIER
).toFixed(2);
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

export const GLOSSARY = {
  escrow: {
    term: "Escrow",
    definition:
      "Money you set aside on chain for your agents; Assay can only take from it for calls that pass our checks.",
  },
  binding: {
    term: "Listing",
    definition:
      "One provider serving one tool at a set price; buyers' calls are routed to it once it is live.",
  },
  delegate: {
    term: "Delegate",
    definition:
      "Your permission for an agent key to pay from your escrow, up to the limits you set, without asking you each time.",
  },
  verdict: {
    term: "Verdict",
    definition: "Our check's decision on one call: passed and charged, or failed and not charged.",
  },
  stake: {
    term: "Stake",
    definition:
      "Money a provider locks up as a promise of quality; part of it can be taken if their tool keeps failing.",
  },
  slash: {
    term: "Penalty (slash)",
    definition:
      "Taking part of a provider's stake because their tool failed more often than they promised.",
  },
  window: {
    term: "Window",
    definition: "A fixed stretch of time over which a provider's failure rate is measured.",
  },
  "free-tier": {
    term: "Free tier",
    definition: "Calls a provider serves at no cost — each agent gets a set number per listing before paying.",
  },
  "not-charged": {
    term: "Not charged",
    definition:
      "What you did not pay at the listed price: calls that failed our checks, gave no usable result, or whose payment was not collected. It is always the listed price minus what was charged, what is owed and what is still in progress.",
  },
  reserved: {
    term: "Reserved",
    definition:
      "A call's price set aside from your balance while its result is checked; it is charged only if the result passes, and released if it does not.",
  },
  "refundable-until": {
    term: "Refundable until",
    definition:
      "The hour after a call is charged. Report a bad result before this time (shown in UTC) and the payment is held back until the report is decided.",
  },
  report: {
    term: "Report a bad result (a dispute)",
    definition:
      "Telling us a charged call's result was wrong: the provider can reply, and Assay's review team decides.",
  },
  "agent-limit": {
    term: "Agent limit",
    definition:
      "The most one agent may spend: per call, per 24 hours or per month. It sits under your account ceiling, and the lowest of the two applies.",
  },
  "account-ceiling": {
    term: "Account ceiling",
    definition:
      "The most any one call can cost, and the most all your agents together can spend in 24 hours. It is enforced on chain, so nobody can go past it, Assay included.",
  },
  usdg: {
    term: "USDG",
    definition: "The dollar stablecoin your balance is held in on this chain: 1 USDG is $1, so amounts are shown in dollars.",
  },
  "stake-rule": {
    term: "Stake rule",
    definition: `A provider that fails clearly more often than it promised (beyond a margin for chance), over at least ${MIN_CHECKED_CALLS} checked calls in a window, loses part of its stake: never more than ${DAILY_CAP_PERCENT}% of it in any 24 hours, and each penalty is limited to a maximum set on chain. Part of it goes to the buyers it served badly. Within its promise, or below ${MIN_CHECKED_CALLS} checked calls, nothing is taken.`,
  },
  "penalty-example": {
    term: "Penalty example",
    definition: `A tool priced $${EXAMPLE.price.toFixed(2)} that promised at most ${pct(EXAMPLE.promised)} failures fails ${pct(EXAMPLE.observed)} of ${EXAMPLE.calls.toLocaleString("en-US")} paid calls in a window: ${EXAMPLE.calls.toLocaleString("en-US")} × $${EXAMPLE.price.toFixed(2)} × (${pct(EXAMPLE.observed)} − ${pct(EXAMPLE.promised)}) × ${PENALTY_MULTIPLIER} = up to about $${EXAMPLE_PENALTY} of its stake. 12% is clearly above 3% over that many calls, so the margin for chance does not save it; the penalty is still never more than ${DAILY_CAP_PERCENT}% of the stake in any 24 hours, nor more than the maximum set on chain.`,
  },
  spent: {
    term: "Spent",
    definition:
      "Money actually charged from your escrow for calls that passed; a payment still owed is shown beside it as owed, never inside it.",
  },
  owed: {
    term: "Owed",
    definition:
      "A call your agent made and used whose payment could not be collected yet; paid calls pause until you settle it.",
  },
  hold: {
    term: "Hold",
    definition:
      "Money reserved from your balance while a call is checked; it is charged if the call passes and released if it fails.",
  },
  "settlement-chain": {
    term: "Settlement chain",
    definition: "The blockchain where a payment is finally recorded and the money actually moves.",
  },
  unbonding: {
    term: "Unbonding",
    definition: "The waiting period after a provider asks to withdraw stake, before the money can be taken out.",
  },
  arbiter: {
    term: "Arbiter",
    definition:
      "A person at Assay, not its servers or automated checks, who rules on a disputed penalty on chain: upheld, or cancelled with nothing taken.",
  },
  dispute: {
    term: "Dispute",
    definition: "A provider's on-chain objection to a penalty, which pauses it until the arbiter decides.",
  },
  credential: {
    term: "Agent key",
    definition: "The secret your agent uses to call tools through Assay; it identifies the agent and what it may spend.",
  },
  "response-shape": {
    term: "Response shape",
    definition: "Checks that the result has the fields and format the tool promises; it runs on every call.",
  },
  "quality-rules": {
    term: "Result quality rules",
    definition:
      "Simple rules the tool publishes for a good result, such as no empty answers, no dead links and no stale data; they run on every call.",
  },
  "cross-check": {
    term: "Independent cross-check",
    definition:
      "For some tools we ask a second, independent source the same question and compare the answers; a result that disagrees fails.",
  },
  "relevance-check": {
    term: "Relevance check",
    definition:
      "An automated reviewer reads the request and the result and judges whether the result actually answers it; it runs on a sample of calls, set by the price.",
  },
  penalty: {
    term: "Penalty",
    definition:
      "Money taken from a provider's stake when their tool fails more often than they promised; buyers who paid in that period are compensated from it.",
  },
  "identity-verified": {
    term: "Identity verified",
    definition:
      "Assay checked who the company behind this provider is; it is not a quality score and says nothing about their stake or failure rate.",
  },
  "observed-failures": {
    term: "Failure rate",
    definition:
      "The share of a provider's checked calls whose result failed, measured by Assay on real calls rather than reported by the provider: the check windows active in the last 30 days (each covers up to 7 days, so the period is approximate), across all their tools, including calls still in an open window. \"Promised at most\" is the rate the provider committed to; penalties are judged against it, one finished check window at a time. \"Not measured yet\" until their first paid calls have been checked.",
  },
  mcp: {
    term: "MCP",
    definition: "Model Context Protocol, the standard way AI agents discover and call tools; Assay is one MCP server.",
  },
} as const satisfies Record<string, { term: string; definition: string }>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Every key, for tests and for a "glossary" listing. */
export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];

export function glossaryEntry(key: GlossaryKey): { term: string; definition: string } {
  return GLOSSARY[key];
}

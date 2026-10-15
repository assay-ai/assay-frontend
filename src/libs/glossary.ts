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
 */

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
    definition: "The amount you would have paid at the listed price but did not, because the result failed our checks.",
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
    definition: "The person appointed on chain to decide disputed penalties, independently of the provider and Assay's checks.",
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

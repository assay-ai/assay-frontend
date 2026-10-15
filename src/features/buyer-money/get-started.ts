import type { SetupStepState } from "@/components/patterns/setup-checklist";

/**
 * The four Get started steps and their state, from data only (never from a
 * click):
 *
 *   1. key   — a live key exists for an agent (and its MCP config was shown);
 *   2. call  — the agent made a call with it (`lastUsedAt` set; polled);
 *   3. funds — money is in the escrow (a deposit opens it);
 *   4. pay   — account ceiling set + the agent's payment key bound + authorised.
 *
 * Free calls need only steps 1–2, so 3 and 4 never block them; 4 is blocked
 * until 3 because caps are set on an escrow, which the first deposit opens.
 */
export interface GetStartedFacts {
  hasLiveKey: boolean;
  firstCallSeen: boolean;
  hasFunds: boolean;
  escrowExists: boolean;
  capsSet: boolean;
  keyBound: boolean;
  grantActive: boolean;
  /** False for accounts whose agents pay from a non-EVM account: step 4 is then just caps. */
  needsDelegation: boolean;
}

export type GetStartedStepId = "key" | "call" | "funds" | "pay";

export function getStartedStates(facts: GetStartedFacts): Record<GetStartedStepId, SetupStepState> {
  const done = {
    key: facts.hasLiveKey,
    call: facts.firstCallSeen,
    funds: facts.hasFunds,
    pay: facts.capsSet && (!facts.needsDelegation || (facts.keyBound && facts.grantActive)),
  };
  const order: GetStartedStepId[] = ["key", "call", "funds", "pay"];
  const blocked: Record<GetStartedStepId, boolean> = {
    key: false,
    call: !done.key,
    funds: false,
    pay: !facts.escrowExists,
  };
  const firstOpen = order.find((id) => !done[id] && !blocked[id]) ?? null;
  return Object.fromEntries(
    order.map((id) => [id, done[id] ? "done" : blocked[id] ? "blocked" : id === firstOpen ? "current" : "todo"]),
  ) as Record<GetStartedStepId, SetupStepState>;
}

/** Which part of step 4 is next. */
export type PayStage = "caps" | "bind" | "authorise" | "done";

export function payStage(facts: Pick<GetStartedFacts, "capsSet" | "keyBound" | "grantActive" | "needsDelegation">): PayStage {
  if (!facts.capsSet) return "caps";
  if (!facts.needsDelegation) return "done";
  if (!facts.keyBound) return "bind";
  if (!facts.grantActive) return "authorise";
  return "done";
}

/**
 * Where `agent-cli` comes from. It has no public install path yet (an open
 * owner question), so the screens say so plainly next to every command that
 * needs it, rather than leaving a buyer to search for a tool they cannot find.
 */
export const AGENT_CLI_SOURCE = "agent-cli is not published yet: get it from your Assay contact.";

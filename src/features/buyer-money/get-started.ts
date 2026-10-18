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
 *
 * Step 4 needs the agent's payment key, made with `agent-cli`, which is not
 * published: paid calls are by invitation during testnet (owner decision
 * D14). Until a payment key is bound, step 4 says so and is not counted as
 * unfinished ({@link payByInvitation}).
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
  /**
   * The account's chain serves free calls only (Solana today, `paid-rails.ts`):
   * no deposit and no paying are possible there, so steps 3 and 4 do not apply
   * and count as done — the checklist can finish after the first call.
   */
  freeOnly?: boolean;
}

export type GetStartedStepId = "key" | "call" | "funds" | "pay";

export function getStartedStates(facts: GetStartedFacts): Record<GetStartedStepId, SetupStepState> {
  const done = {
    key: facts.hasLiveKey,
    call: facts.firstCallSeen,
    funds: facts.freeOnly === true || facts.hasFunds,
    pay: facts.freeOnly === true || (facts.capsSet && (!facts.needsDelegation || (facts.keyBound && facts.grantActive))),
  };
  const order: GetStartedStepId[] = ["key", "call", "funds", "pay"];
  const blocked: Record<GetStartedStepId, boolean> = {
    key: false,
    call: !done.key,
    funds: false,
    pay: !facts.escrowExists,
  };
  // By invitation: neither blocked nor next, and never "current".
  const invitation = payByInvitation(facts);
  if (invitation) blocked.pay = false;
  const firstOpen = order.find((id) => !done[id] && !blocked[id] && !(id === "pay" && invitation)) ?? null;
  return Object.fromEntries(
    order.map((id) => [id, done[id] ? "done" : blocked[id] ? "blocked" : id === firstOpen ? "current" : "todo"]),
  ) as Record<GetStartedStepId, SetupStepState>;
}

/**
 * Paying needs a payment key and none is bound yet: step 4 reads "Paid calls:
 * by invitation during testnet" and is not counted (D14). Once a key is bound
 * (an invited buyer ran `agent-cli bind`), step 4 counts as before.
 */
export function payByInvitation(facts: GetStartedFacts): boolean {
  return facts.freeOnly !== true && facts.needsDelegation && !facts.keyBound;
}

/** Every counted step is done: step 4 by invitation does not hold the checklist open. */
export function getStartedComplete(facts: GetStartedFacts): boolean {
  const states = getStartedStates(facts);
  const invitation = payByInvitation(facts);
  return (Object.entries(states) as [GetStartedStepId, SetupStepState][]).every(
    ([id, state]) => state === "done" || (id === "pay" && invitation),
  );
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
 * Paid calls during testnet (D14): by invitation, because the payment key is
 * made with `agent-cli`, which has no public install path. Said plainly where
 * paying would be set up, with "Ask for access" when `SUPPORT_URL` is set.
 */
export const PAID_BY_INVITATION_TITLE = "Paid calls: by invitation during testnet";
export const PAID_BY_INVITATION_TEXT =
  "Paid calls are by invitation during testnet: paying needs a payment key made with agent-cli, which only invited testers have for now. Free calls work without it.";

/** For an invited buyer, next to the command: where `agent-cli` comes from. */
export const AGENT_CLI_SOURCE = "Invited already? Your Assay contact gives you agent-cli. Run this on the agent's machine:";

/** A catalogue row, as much of it as the step 2 prompt needs. */
export interface PromptTool {
  name: string;
  toolId?: string;
  pricingMode: string | null;
  routable: boolean;
  freeCallsPerDay?: number | null;
}

/**
 * Step 2's example: a tool this agent can reach now that has free calls (a
 * FREE tool first, then one with free calls a day), named the way the agent
 * sees it. No such tool: a prompt that names none, never a tool that would be
 * refused or charged.
 */
export function firstCallPrompt(tools: readonly PromptTool[], mcpName: (tool: PromptTool) => string | null): string {
  const reachable = tools.filter((tool) => tool.routable && mcpName(tool));
  const free =
    reachable.find((tool) => tool.pricingMode === "FREE") ??
    reachable.find((tool) => tool.pricingMode === "FREEMIUM" && (tool.freeCallsPerDay ?? 0) > 0);
  if (!free) return "Ask your agent to use one of the tools from Assay. This step ticks itself when the call arrives.";
  const name = mcpName(free)!;
  return `For example, ask it to “use the ${name} tool from Assay”. ${name} has free calls, so no money is needed. This step ticks itself when the call arrives.`;
}

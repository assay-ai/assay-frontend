import { shortId } from "@/components/patterns/copy-chip";
import { stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";

/**
 * A contract call in plain words, for the lines shown next to a sign or
 * download button (operator review 2026-10-16b, P0-1).
 *
 * Built from the DECODED call (function and arguments read out of the
 * calldata against the pinned contract), never from a server label or from
 * what the screen meant to send. Only the hex stays under Technical details:
 * the action, the target, the contract, the chain and the signer are never
 * hidden (RESEARCH-standards §1.6, §4.5).
 *
 *   Action    Block wallet 0x9F3c…F36c on chain
 *   Contract  Config contract 0x7d4F…231c
 *   Chain     Robinhood Chain testnet
 *   Signed by Arbiter key 0x5B38…ddC4
 *   Funds     None sent. The signer's wallet pays the network fee.
 */

export type CallContract = "escrow" | "stake" | "config" | "token";

export interface CallSummaryInput {
  readonly functionName: string;
  readonly args: readonly unknown[];
  readonly contract: CallContract;
  /** The contract address the call goes to. */
  readonly to: string;
  /** CAIP-2. */
  readonly chainId: string;
  /** The only key that may sign it, when known. */
  readonly signer: string | null;
  /** "arbiter", "admin": who that key is. Default "arbiter". */
  readonly signerRole?: string;
}

export interface CallSummaryLine {
  readonly label: string;
  readonly value: string;
}

const CONTRACT_NAME: Readonly<Record<CallContract, string>> = {
  escrow: "Escrow contract",
  stake: "Stake contract",
  config: "Config contract",
  token: "Settlement token",
};

/** "Robinhood Chain testnet", or "Chain 46630" for a chain this build has no name for. */
export function chainDisplayName(chainId: string): string {
  return stakeDeploymentFor(chainId)?.displayName ?? `Chain ${chainId.split(":")[1] ?? chainId}`;
}

/** True when the pinned deployment of this chain is a testnet. */
export function isTestnetChain(chainId: string): boolean {
  return /testnet/i.test(stakeDeploymentFor(chainId)?.displayName ?? "");
}

function idList(ids: readonly unknown[]): string {
  const shown = ids.slice(0, 3).map((id) => shortId(String(id)));
  const more = ids.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function penalties(count: number): string {
  return `${count} penalt${count === 1 ? "y" : "ies"}`;
}

/** What the call does, in one line: "Uphold 2 disputed penalties: 0xb2b2…b2b2, 0xc3c3…c3c3". */
export function callAction(functionName: string, args: readonly unknown[]): string {
  const [first, second] = args;
  switch (functionName) {
    case "setBlocked":
      return second === true || second === "true"
        ? `Block wallet ${shortId(String(first))} on chain`
        : `Lift the on-chain block of wallet ${shortId(String(first))}`;
    case "upholdSlashBatch": {
      const ids = Array.isArray(first) ? first : [];
      return `Uphold ${ids.length} disputed ${ids.length === 1 ? "penalty" : "penalties"}: ${idList(ids)}`;
    }
    case "cancelSlashBatch": {
      const ids = Array.isArray(first) ? first : [];
      return `Cancel ${penalties(ids.length)} on chain: ${idList(ids)}`;
    }
    case "cancelSlash":
      return `Cancel the penalty record ${shortId(String(first))} on chain`;
    case "setPaused":
      return first === true || first === "true" ? "Pause the contracts: every payment, deposit, withdrawal, stake and penalty stops" : "Resume the contracts";
    case "updateConfig":
      return "Replace the fee and stake settings (every field is written; the changed ones are listed above)";
    case "registerVerifier":
      return `Add verifier key ${shortId(String(first))}`;
    case "revokeVerifier":
      return `Revoke verifier key ${shortId(String(first))} for good`;
    case "setArbiter":
      return `Make ${shortId(String(first))} the arbiter`;
    case "setSlashDelay":
      return `Set the penalty dispute window to ${durationWords(Number(first))}`;
    default:
      return `${functionName}(${args.map((arg) => (Array.isArray(arg) ? `[${arg.length}]` : shortId(String(arg)))).join(", ")})`;
  }
}

/** 259200 → "3 days", 5400 → "90 min": the dispute window in a sentence. */
export function durationWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return `${seconds} s`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

export function callSummary(input: CallSummaryInput): CallSummaryLine[] {
  const role = (input.signerRole ?? "arbiter").replace(/^the /i, "");
  const roleWord = role.charAt(0).toUpperCase() + role.slice(1);
  return [
    { label: "Action", value: callAction(input.functionName, input.args) },
    { label: "Contract", value: `${CONTRACT_NAME[input.contract]} ${shortId(input.to)}` },
    { label: "Chain", value: chainDisplayName(input.chainId) },
    { label: "Signed by", value: input.signer ? `${roleWord} key ${shortId(input.signer)}` : `The ${role} key` },
    { label: "Funds", value: "None sent. The signer's wallet pays the network fee." },
  ];
}

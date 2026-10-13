import { parseAbi, toEventSelector } from "viem";

/**
 * The slice of the X402Stake ABI this page reads, copied from
 * `assay-evm/out/X402Stake.sol/X402Stake.json` (the source of truth; see
 * `src/X402Stake.sol` for the comments).
 *
 * ## Only what exists today
 *
 * A `disputeSlash(requestId)` door, a `Disputed` status and `SlashDisputed` /
 * `SlashUpheld` events are being added in parallel. Nothing here depends on
 * them:
 *
 * - `status` is decoded as a plain `uint8`, which is what an `enum` is on the
 *   wire, so a value the frontend does not know (4 = Disputed, or anything
 *   later) decodes instead of throwing. `status.ts` names it.
 * - A struct that grows new trailing fields still decodes: the decoder reads
 *   the fields it knows by offset and ignores the rest.
 * - Unknown events in a log scan are skipped by `parseStakeLog`, so a log from
 *   the new events is never an error.
 *
 * ## Indexing — why one `eth_getLogs` per range is enough
 *
 * In all three events `requestId` is `topic1` and `provider` is `topic2`
 * (`SlashProposed` and `SlashExecuted` also index `verifier` as `topic3`). So a
 * single query with `topics: [[proposed, executed, cancelled], null,
 * providerTopic]` returns exactly one provider's slash history, in one round
 * trip per block range.
 */
export const STAKE_EVENTS_ABI = parseAbi([
  "event SlashProposed(bytes32 indexed requestId, address indexed provider, address indexed verifier, address beneficiary, bytes32 policy, uint64 penalty, uint64 reserved, uint64 capAllowance, uint64 pendingSlash, uint64 proposedAt, uint64 executableAt)",
  "event SlashExecuted(bytes32 indexed requestId, address indexed provider, address indexed verifier, address beneficiary, bytes32 policy, uint64 penalty, uint64 applied, uint64 agentAmount, uint64 platformAmount, uint64 providerAmount, uint16 slashAgentBps, uint16 slashPlatformBps, uint64 released, uint64 pendingSlash, uint128 bonded, uint64 unbonding, uint64 executedAt, uint64 proposedAt)",
  "event SlashCancelled(bytes32 indexed requestId, address indexed provider, uint8 reason, uint64 released, uint64 pendingSlash, uint64 cancelledAt)",
]);

export const SLASH_PROPOSED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[0]);
export const SLASH_EXECUTED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[1]);
export const SLASH_CANCELLED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[2]);

export const SLASH_EVENT_TOPICS = [
  SLASH_PROPOSED_TOPIC,
  SLASH_EXECUTED_TOPIC,
  SLASH_CANCELLED_TOPIC,
] as const;

/** `slashRecordOf(bytes32)` — the record's current state. `status` stays a `uint8` on purpose. */
export const STAKE_VIEWS_ABI = [
  {
    type: "function",
    name: "slashRecordOf",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "provider", type: "address" },
          { name: "status", type: "uint8" },
          { name: "penalty", type: "uint64" },
          { name: "beneficiary", type: "address" },
          { name: "proposedAt", type: "uint64" },
          { name: "__gap", type: "uint32" },
          { name: "verifier", type: "address" },
          { name: "executableAt", type: "uint64" },
          { name: "__gap2", type: "uint32" },
          { name: "reserved", type: "uint64" },
          { name: "capAllowance", type: "uint64" },
          { name: "applied", type: "uint64" },
          { name: "executedAt", type: "uint64" },
          { name: "policy", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "ASSET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

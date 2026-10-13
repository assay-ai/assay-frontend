import { parseAbi, toEventSelector } from "viem";

/**
 * The slice of the X402Stake ABI this page reads, copied from
 * `assay-evm/out/X402Stake.sol/X402Stake.json` (the source of truth; see
 * `src/X402Stake.sol` for the comments).
 *
 * ## The dispute upgrade (assay-evm D-19)
 *
 * `disputeSlash`, a `Disputed` status (4), a `DisputeUnresolved` cancel
 * reason (3), the `SlashDisputed` and `SlashUpheld` events and a 13th record
 * field, `disputedAt`. Only the upgraded contract is read.
 *
 * - `status` is decoded as a plain `uint8`, which is what an `enum` is on the
 *   wire, so a value the frontend does not know decodes instead of throwing.
 *   `status.ts` names it.
 * - Unknown events in a log scan are skipped by `parseStakeLog`, so a log from
 *   an event added later is never an error.
 *
 * ## Indexing — why one `eth_getLogs` per range is enough
 *
 * In all five events `requestId` is `topic1` and `provider` is `topic2`
 * (`SlashProposed` and `SlashExecuted` also index `verifier` as `topic3`,
 * `SlashUpheld` the `arbiter`). So a single query with
 * `topics: [[proposed, executed, cancelled, disputed, upheld], null, providerTopic]`
 * returns exactly one provider's slash history, in one round trip per block range.
 */
export const STAKE_EVENTS_ABI = parseAbi([
  "event SlashProposed(bytes32 indexed requestId, address indexed provider, address indexed verifier, address beneficiary, bytes32 policy, uint64 penalty, uint64 reserved, uint64 capAllowance, uint64 pendingSlash, uint64 proposedAt, uint64 executableAt)",
  "event SlashExecuted(bytes32 indexed requestId, address indexed provider, address indexed verifier, address beneficiary, bytes32 policy, uint64 penalty, uint64 applied, uint64 agentAmount, uint64 platformAmount, uint64 providerAmount, uint16 slashAgentBps, uint16 slashPlatformBps, uint64 released, uint64 pendingSlash, uint128 bonded, uint64 unbonding, uint64 executedAt, uint64 proposedAt)",
  "event SlashCancelled(bytes32 indexed requestId, address indexed provider, uint8 reason, uint64 released, uint64 pendingSlash, uint64 cancelledAt)",
  "event SlashDisputed(bytes32 indexed requestId, address indexed provider, uint64 disputedAt, uint64 executableAt)",
  "event SlashUpheld(bytes32 indexed requestId, address indexed provider, address indexed arbiter, uint64 executableAt)",
]);

export const SLASH_PROPOSED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[0]);
export const SLASH_EXECUTED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[1]);
export const SLASH_CANCELLED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[2]);
export const SLASH_DISPUTED_TOPIC = toEventSelector(STAKE_EVENTS_ABI[3]);
export const SLASH_UPHELD_TOPIC = toEventSelector(STAKE_EVENTS_ABI[4]);

export const SLASH_EVENT_TOPICS = [
  SLASH_PROPOSED_TOPIC,
  SLASH_EXECUTED_TOPIC,
  SLASH_CANCELLED_TOPIC,
  SLASH_DISPUTED_TOPIC,
  SLASH_UPHELD_TOPIC,
] as const;

/** `slashRecordOf(bytes32)` — the record's current state (13 fields). `status` stays a `uint8` on purpose. */
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
          { name: "disputedAt", type: "uint64" },
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

/**
 * `Constants.DISPUTE_TIMEOUT_SECONDS` (30 days, `assay-evm/src/Constants.sol`):
 * a `Disputed` record nobody ruled on can be expired from `disputedAt` + this,
 * with `CancelReason.DisputeUnresolved`.
 */
export const DISPUTE_TIMEOUT_SECONDS = 30 * 86_400;

/** `Constants.MAX_SLASH_BATCH`: the most ids `disputeSlashBatch` and the arbiter batches take. */
export const MAX_SLASH_BATCH = 64;

export const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

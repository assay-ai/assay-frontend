import {
  bytesToHex,
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  encodeFunctionData,
  formatUnits,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import type { SlashContractCall } from "@/interfaces/slash-dispute";

export type { Address } from "viem";

import type { ExpectedCall } from "./signing-guard";
import { ERC20_METADATA_ABI } from "./stake-slashes/abi";
import type { StakeDeployment } from "./stake-slashes/deployments";
import { scanLogsChunked, type LogSource, type RawLog } from "./stake-slashes/scan";

/**
 * The admin's settings on the X402Config contract: read from the pinned RPC,
 * and the admin's calls built here, from what the operator typed.
 *
 * Nothing on this path goes through Assay's backend. The settings page exists
 * so the admin stops filling forms in a block explorer; a backend that could
 * name the contract, the values or the calldata would be a worse explorer. So
 * the address is the pinned one (`deployments.ts`), the current values are
 * read straight from it, and every call is ABI-encoded in the browser and then
 * decoded again by `ContractCallAction` before it is offered for signing.
 *
 * The admin is the only key that can send these; the owner's doors (`setAdmin`,
 * upgrades) are not built here at all.
 */

/** `ParamSet` (assay-evm `Types.sol`), in field order. Raw on-chain units. */
export interface ConfigParams {
  readonly treasury: Address;
  readonly redeemer: Address;
  readonly unbondingPeriodSeconds: bigint;
  readonly minimumStake: bigint;
  readonly penaltyAmount: bigint;
  readonly verifierDailyCap: bigint;
  readonly takeRateBps: number;
  readonly slashAgentBps: number;
  readonly slashPlatformBps: number;
  readonly slashCapBps: number;
}

export const CONFIG_PARAM_KEYS = [
  "treasury",
  "redeemer",
  "unbondingPeriodSeconds",
  "minimumStake",
  "penaltyAmount",
  "verifierDailyCap",
  "takeRateBps",
  "slashAgentBps",
  "slashPlatformBps",
  "slashCapBps",
] as const satisfies readonly (keyof ConfigParams)[];

export type ConfigParamKey = (typeof CONFIG_PARAM_KEYS)[number];

const PARAM_SET =
  "struct ParamSet { address treasury; address redeemer; uint64 unbondingPeriodSeconds; uint64 minimumStake; uint64 penaltyAmount; uint64 verifierDailyCap; uint16 takeRateBps; uint16 slashAgentBps; uint16 slashPlatformBps; uint16 slashCapBps; }";

/** The admin's doors on X402Config — the only functions this page sends. */
export const CONFIG_ADMIN_ABI = parseAbi([
  PARAM_SET,
  "function setPaused(bool value)",
  "function updateConfig(ParamSet p, address newAdmin)",
  "function registerVerifier(address verifier, bytes32 label, uint64 expiresAt)",
  "function revokeVerifier(address verifier)",
  "function setArbiter(address newArbiter)",
  "function setSlashDelay(uint64 newDelay)",
]);

export const CONFIG_VIEWS_ABI = parseAbi([
  PARAM_SET,
  "struct VerifierKey { uint64 registeredAt; uint64 expiresAt; uint64 revokedAt; bool registered; bool revoked; }",
  "function admin() view returns (address)",
  "function owner() view returns (address)",
  "function arbiter() view returns (address)",
  "function paused() view returns (bool)",
  "function slashDelaySeconds() view returns (uint64)",
  "function params() view returns (ParamSet)",
  "function verifierKey(address verifier) view returns (VerifierKey)",
  "function ASSET() view returns (address)",
]);

const VERIFIER_REGISTERED = parseAbiItem(
  "event VerifierRegistered(address indexed verifier, address indexed admin, bytes32 label, uint64 registeredAt, uint64 expiresAt)",
);
/** Only registrations are scanned: whether a key was revoked since is read from `verifierKey`. */
const VERIFIER_REGISTERED_TOPIC = encodeEventTopics({ abi: [VERIFIER_REGISTERED], eventName: "VerifierRegistered" })[0] as Hex;

// ── Limits the contract enforces (assay-evm `Constants.sol`) ────────────────

export const CONFIG_LIMITS = Object.freeze({
  maxTakeRateBps: 3_000,
  maxSlashCapBps: 5_000,
  minUnbondingSeconds: 11 * 86_400,
  maxUnbondingSeconds: 30 * 86_400,
  minSlashDelaySeconds: 10 * 60,
  maxSlashDelaySeconds: 22 * 86_400,
  maxVerifierLifetimeSeconds: 365 * 86_400,
});

// ── Reading ────────────────────────────────────────────────────────────────

export interface ContractSettings {
  readonly chainId: string;
  readonly config: Address;
  readonly owner: Address;
  readonly admin: Address;
  /** `null` before the first appointment (the slot reads `address(0)`). */
  readonly arbiter: Address | null;
  readonly paused: boolean;
  readonly slashDelaySeconds: number;
  readonly params: ConfigParams;
  /** The settlement token's scale, for the money fields. */
  readonly asset: { readonly decimals: number; readonly symbol: string; readonly fromChain: boolean };
}

export type VerifierStatus = "active" | "expired" | "revoked";

export interface VerifierKeyRow {
  readonly address: Address;
  /** The label written at registration, as text. */
  readonly label: string;
  readonly registeredAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly status: VerifierStatus;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Everything the settings page reads. A test hands in a fake. */
export interface ConfigChainReader extends LogSource {
  readSettings(): Promise<ContractSettings>;
  readVerifierKey(address: Address): Promise<{ registeredAt: bigint; expiresAt: bigint; revokedAt: bigint; registered: boolean; revoked: boolean }>;
}

export function createConfigChainReader(deployment: StakeDeployment): ConfigChainReader {
  const client = createPublicClient({ transport: http(deployment.rpcUrl, { retryCount: 1, timeout: 20_000 }) });
  const address = deployment.configContract;
  const read = <T>(functionName: string, args?: readonly unknown[]) =>
    client.readContract({ address, abi: CONFIG_VIEWS_ABI, functionName: functionName as any, args: args as any }) as Promise<T>;

  return {
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    async getLogs(range) {
      const logs = await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: range.address,
            fromBlock: `0x${range.fromBlock.toString(16)}`,
            toBlock: `0x${range.toBlock.toString(16)}`,
            topics: range.topics as (Hex | Hex[] | null)[],
          },
        ],
      });
      return logs as unknown as RawLog[];
    },
    readVerifierKey: (verifier) => read("verifierKey", [verifier]),
    async readSettings() {
      const [owner, admin, arbiter, paused, delay, params] = await Promise.all([
        read<Address>("owner"),
        read<Address>("admin"),
        read<Address>("arbiter"),
        read<boolean>("paused"),
        read<bigint>("slashDelaySeconds"),
        read<ConfigParams>("params"),
      ]);
      let asset: ContractSettings["asset"];
      try {
        const [decimals, symbol] = await Promise.all([
          client.readContract({ address: deployment.settlementToken, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
          client.readContract({ address: deployment.settlementToken, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
        ]);
        asset = { decimals: Number(decimals), symbol, fromChain: true };
      } catch {
        asset = { decimals: deployment.fallbackAssetDecimals, symbol: deployment.fallbackAssetSymbol, fromChain: false };
      }
      return {
        chainId: deployment.chainId,
        config: address,
        owner,
        admin,
        arbiter: arbiter.toLowerCase() === ZERO_ADDRESS ? null : arbiter,
        paused,
        slashDelaySeconds: Number(delay),
        params: { ...params, takeRateBps: Number(params.takeRateBps), slashAgentBps: Number(params.slashAgentBps), slashPlatformBps: Number(params.slashPlatformBps), slashCapBps: Number(params.slashCapBps) },
        asset,
      };
    },
  };
}

// ── Units and addresses, for the settings form (screens do not import viem) ──

/** `1500000` at 6 decimals → "1.5". */
export function formatTokenUnits(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

/** "1.5" at 6 decimals → `1500000`. The text must already be a plain decimal. */
export function parseTokenUnits(text: string, decimals: number): bigint {
  return parseUnits(text, decimals);
}

/** The checksummed address, or null when `text` is not one (any case accepted). */
export function checksumAddress(text: string): Address | null {
  return isAddress(text, { strict: false }) ? getAddress(text) : null;
}

/** `bytes32` label → text: the UTF-8 bytes up to the first zero. */
export function labelText(label: Hex): string {
  const bytes = hexToBytes(label);
  const end = bytes.indexOf(0);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(end === -1 ? bytes : bytes.slice(0, end));
  } catch {
    return label;
  }
}

/** Text → `bytes32`, zero-padded on the right. Throws above 32 bytes. */
export function labelBytes32(text: string): Hex {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 32) throw new Error("A key label is at most 32 bytes.");
  const out = new Uint8Array(32);
  out.set(bytes);
  return bytesToHex(out);
}

/** Every key ever registered (the events), with its state read now (`verifierKey`). Newest first. */
export async function loadVerifierKeys(reader: ConfigChainReader, deployment: StakeDeployment, nowSeconds: number): Promise<VerifierKeyRow[]> {
  const head = await reader.getBlockNumber();
  const logs = await scanLogsChunked(reader, {
    address: deployment.configContract,
    fromBlock: deployment.configDeployBlock,
    toBlock: head,
    topics: [VERIFIER_REGISTERED_TOPIC],
  });
  const seen = new Map<string, { address: Address; label: string }>();
  for (const log of logs) {
    const decoded = decodeEventLog({ abi: [VERIFIER_REGISTERED], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    const args = decoded.args as { verifier: Address; label: Hex };
    // Registration is one-shot per address, so an address appears once; keep the first anyway.
    if (!seen.has(args.verifier.toLowerCase())) seen.set(args.verifier.toLowerCase(), { address: args.verifier, label: labelText(args.label) });
  }
  const rows = await Promise.all(
    [...seen.values()].map(async ({ address, label }) => {
      const key = await reader.readVerifierKey(address);
      return verifierRow(address, label, key, nowSeconds);
    }),
  );
  return rows.sort((a, b) => b.registeredAt - a.registeredAt);
}

export function verifierRow(
  address: Address,
  label: string,
  key: { registeredAt: bigint; expiresAt: bigint; revokedAt: bigint; revoked: boolean },
  nowSeconds: number,
): VerifierKeyRow {
  const expiresAt = Number(key.expiresAt);
  return {
    address,
    label,
    registeredAt: Number(key.registeredAt),
    expiresAt,
    revokedAt: key.revoked ? Number(key.revokedAt) : null,
    status: key.revoked ? "revoked" : nowSeconds > expiresAt ? "expired" : "active",
  };
}

/** Keys that can sign now: registered, not revoked, not expired. */
export function liveVerifiers(rows: readonly VerifierKeyRow[]): VerifierKeyRow[] {
  return rows.filter((row) => row.status === "active");
}

// ── Building the admin's calls ─────────────────────────────────────────────

export type ConfigAdminCall =
  | { readonly functionName: "setPaused"; readonly args: readonly [boolean] }
  | { readonly functionName: "updateConfig"; readonly args: readonly [ConfigParams, Address] }
  | { readonly functionName: "registerVerifier"; readonly args: readonly [Address, Hex, bigint] }
  | { readonly functionName: "revokeVerifier"; readonly args: readonly [Address] }
  | { readonly functionName: "setArbiter"; readonly args: readonly [Address] }
  | { readonly functionName: "setSlashDelay"; readonly args: readonly [bigint] };

/**
 * The unsigned call, from the admin, to the pinned config contract — plus the
 * `ExpectedCall` that `ContractCallAction` checks its decoded calldata against.
 */
export function buildConfigCall(
  deployment: StakeDeployment,
  admin: Address,
  call: ConfigAdminCall,
): { call: SlashContractCall; expected: ExpectedCall } {
  const data = encodeFunctionData({
    abi: CONFIG_ADMIN_ABI,
    functionName: call.functionName,
    args: call.args as any,
  });
  return {
    call: {
      chainId: deployment.chainId,
      to: deployment.configContract,
      data,
      value: "0",
      signer: admin,
      signerRole: "ADMIN",
      functionName: call.functionName,
      requestIds: [],
    },
    expected: { contract: "config", functionName: call.functionName, args: call.args },
  };
}

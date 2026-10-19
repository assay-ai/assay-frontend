import {
  CONFIG_LIMITS,
  checksumAddress,
  formatTokenUnits as formatUnits,
  parseTokenUnits as parseUnits,
  ZERO_ADDRESS,
  type Address,
  type ConfigParamKey,
  type ConfigParams,
  type ContractSettings,
  type VerifierKeyRow,
} from "@/libs/chains/evm/contract-config";

import { durationWords } from "./call-summary";

/**
 * Contracts, the admin's settings page: what each setting is called, how it
 * is typed (percent, days, dollars — never basis points or raw units), and the
 * contract's own rules checked BEFORE the wallet opens, in words.
 *
 * Every check here mirrors a revert in assay-evm `AssayConfig.sol`
 * (`_validate`, `_assertRolesDistinct`, `registerVerifier`, `setSlashDelay`),
 * so a change the chain would refuse is stopped on the form, next to the field
 * it is about, instead of as a failed gas estimate.
 */

const UINT64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const DAY = 86_400;

// ── The fee and stake settings (`updateConfig`) ─────────────────────────────

/** The form, as typed. */
export type ParamsForm = Record<ConfigParamKey, string>;

export type ParamKind = "address" | "percent" | "money" | "days";

export interface ParamField {
  readonly key: ConfigParamKey;
  readonly label: string;
  readonly kind: ParamKind;
  /** One sentence: what it changes for whom. */
  readonly help: string;
  /** A change that moves where money goes: shown in red on the review. */
  readonly critical?: boolean;
}

export interface ParamGroup {
  readonly title: string;
  readonly fields: readonly ParamField[];
}

export const PARAM_GROUPS: readonly ParamGroup[] = [
  {
    title: "Fees",
    fields: [
      { key: "takeRateBps", label: "Platform fee", kind: "percent", help: `Assay's share of every paid call. At most ${CONFIG_LIMITS.maxTakeRateBps / 100}%.` },
    ],
  },
  {
    title: "Penalties",
    fields: [
      {
        key: "penaltyAmount",
        label: "Most one penalty part can take",
        kind: "money",
        help: "A penalty is worked out per window off chain (its calls' value × how far over the declared failure rate × the multiplier), then split among the agents it harmed. Each agent's part is capped at this. 0 records penalties without taking anything.",
      },
      { key: "slashCapBps", label: "Penalty cap (share of stake)", kind: "percent", help: `A share of the provider's stake. At most ${CONFIG_LIMITS.maxSlashCapBps / 100}%.` },
      { key: "slashAgentBps", label: "Paid to the agent", kind: "percent", help: "The share of a penalty paid to the agent whose calls failed. More than 0%." },
      { key: "slashPlatformBps", label: "Paid to the treasury", kind: "percent", help: "The share kept by Assay. The rest stays with the provider." },
      { key: "verifierDailyCap", label: "Verifier daily limit", kind: "money", help: "The most one verifier key can penalise in a day, all parts together. At least two penalty parts." },
    ],
  },
  {
    title: "Provider stake",
    fields: [
      { key: "minimumStake", label: "Minimum stake", kind: "money", help: "What a provider must stake before paid calls reach their tools." },
      { key: "unbondingPeriodSeconds", label: "Unstake wait", kind: "days", help: "How long a provider waits between asking to unstake and withdrawing. 11 to 30 days." },
    ],
  },
  {
    title: "Wallets",
    fields: [
      { key: "treasury", label: "Treasury", kind: "address", help: "Receives the platform fee and the treasury's share of penalties.", critical: true },
      { key: "redeemer", label: "Redeemer", kind: "address", help: "The backend key that redeems vouchers. Change it only together with the backend.", critical: true },
    ],
  },
];

export const PARAM_FIELDS: readonly ParamField[] = PARAM_GROUPS.flatMap((group) => group.fields);

export function paramField(key: ConfigParamKey): ParamField {
  return PARAM_FIELDS.find((field) => field.key === key)!;
}

/** 1000 → "10", 1250 → "12.5". */
function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

function secondsToDays(seconds: bigint): string {
  const days = Number(seconds) / DAY;
  return String(Math.round(days * 10_000) / 10_000);
}

/** The current settings, as the form shows them. */
export function paramsToForm(params: ConfigParams, decimals: number): ParamsForm {
  return {
    treasury: params.treasury,
    redeemer: params.redeemer,
    unbondingPeriodSeconds: secondsToDays(params.unbondingPeriodSeconds),
    minimumStake: formatUnits(params.minimumStake, decimals),
    penaltyAmount: formatUnits(params.penaltyAmount, decimals),
    verifierDailyCap: formatUnits(params.verifierDailyCap, decimals),
    takeRateBps: bpsToPercent(params.takeRateBps),
    slashAgentBps: bpsToPercent(params.slashAgentBps),
    slashPlatformBps: bpsToPercent(params.slashPlatformBps),
    slashCapBps: bpsToPercent(params.slashCapBps),
  };
}

/** "12.5" → 1250; null when it is not a percent with at most two decimals. */
export function percentToBps(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** "11" → 950400; null when it is not a number of days (to the second). */
export function daysToSeconds(text: string): bigint | null {
  const value = text.trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(value)) return null;
  return BigInt(Math.round(Number(value) * DAY));
}

/** "1.5" → 1500000 at 6 decimals; null when it is no amount, has too many decimals or overflows `uint64`. */
export function moneyToRaw(text: string, decimals: number): bigint | null {
  const value = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  const raw = parseUnits(value, decimals);
  return raw > UINT64_MAX ? null : raw;
}

export type FormErrors = Partial<Record<ConfigParamKey, string>>;

export type ParamsCheck = { ok: true; params: ConfigParams } | { ok: false; errors: FormErrors };

/**
 * The form as a `ParamSet`, or the reason per field the contract would refuse
 * it (`_validate`, and `_assertRolesDistinct`'s "the redeemer is never the
 * arbiter").
 */
export function formToParams(
  form: ParamsForm,
  context: { decimals: number; symbol: string; arbiter: Address | null },
): ParamsCheck {
  const errors: FormErrors = {};
  const address = (key: "treasury" | "redeemer"): Address | null => {
    const value = form[key].trim();
    const address = checksumAddress(value);
    if (!address) {
      errors[key] = "Enter a wallet address: 0x and 40 hex characters.";
      return null;
    }
    if (value.toLowerCase() === ZERO_ADDRESS) {
      errors[key] = "The zero address cannot receive anything.";
      return null;
    }
    return address;
  };
  const percent = (key: "takeRateBps" | "slashAgentBps" | "slashPlatformBps" | "slashCapBps"): number | null => {
    const bps = percentToBps(form[key]);
    if (bps === null || bps > 10_000) {
      errors[key] = "Enter a percent between 0 and 100, with at most two decimals.";
      return null;
    }
    return bps;
  };
  const money = (key: "minimumStake" | "penaltyAmount" | "verifierDailyCap"): bigint | null => {
    const raw = moneyToRaw(form[key], context.decimals);
    if (raw === null) {
      errors[key] = `Enter a dollar amount, with at most ${context.decimals} decimals.`;
      return null;
    }
    return raw;
  };

  const treasury = address("treasury");
  const redeemer = address("redeemer");
  const takeRateBps = percent("takeRateBps");
  const slashAgentBps = percent("slashAgentBps");
  const slashPlatformBps = percent("slashPlatformBps");
  const slashCapBps = percent("slashCapBps");
  const minimumStake = money("minimumStake");
  const penaltyAmount = money("penaltyAmount");
  const verifierDailyCap = money("verifierDailyCap");
  const unbonding = daysToSeconds(form.unbondingPeriodSeconds);
  if (unbonding === null) errors.unbondingPeriodSeconds = "Enter a number of days.";

  if (redeemer && context.arbiter && redeemer.toLowerCase() === context.arbiter.toLowerCase()) {
    errors.redeemer = "The redeemer cannot be the arbiter's wallet.";
  }
  if (takeRateBps !== null && takeRateBps > CONFIG_LIMITS.maxTakeRateBps) {
    errors.takeRateBps = `The contract allows at most ${CONFIG_LIMITS.maxTakeRateBps / 100}%.`;
  }
  if (slashAgentBps !== null && slashAgentBps === 0) errors.slashAgentBps = "The agent's share must be more than 0%.";
  if (slashAgentBps !== null && slashPlatformBps !== null && slashAgentBps + slashPlatformBps > 10_000) {
    errors.slashPlatformBps = `The agent's and the treasury's shares add up to ${(slashAgentBps + slashPlatformBps) / 100}%, more than 100%.`;
  }
  if (slashCapBps !== null && (slashCapBps === 0 || slashCapBps > CONFIG_LIMITS.maxSlashCapBps)) {
    errors.slashCapBps = `Enter more than 0% and at most ${CONFIG_LIMITS.maxSlashCapBps / 100}%.`;
  }
  if (unbonding !== null && (unbonding < BigInt(CONFIG_LIMITS.minUnbondingSeconds) || unbonding > BigInt(CONFIG_LIMITS.maxUnbondingSeconds))) {
    errors.unbondingPeriodSeconds = "The contract allows 11 to 30 days.";
  }
  if (minimumStake !== null && minimumStake === BigInt(0)) errors.minimumStake = "The minimum stake must be more than 0.";
  if (verifierDailyCap !== null && verifierDailyCap === BigInt(0)) errors.verifierDailyCap = "The daily limit must be more than 0.";
  if (penaltyAmount !== null) {
    const two = BigInt(2) * penaltyAmount;
    const fmt = (raw: bigint) => dollars(raw, context.decimals);
    // `minimumStake * slashCapBps / 10_000 >= 2 * penaltyAmount`: two maximal penalties fit a provider at the minimum.
    if (minimumStake !== null && minimumStake > BigInt(0) && slashCapBps !== null && slashCapBps > 0 && !errors.minimumStake) {
      const capAtMinimum = (minimumStake * BigInt(slashCapBps)) / BigInt(10_000);
      if (capAtMinimum < two) {
        errors.penaltyAmount = `Too high for the minimum stake: ${slashCapBps / 100}% of ${fmt(minimumStake)} is ${fmt(capAtMinimum)}, and two penalties (${fmt(two)}) must fit in it. Lower the penalty or raise the minimum stake.`;
      }
    }
    // `verifierDailyCap >= 2 * penaltyAmount`: two penalties fit in one key-day.
    if (verifierDailyCap !== null && verifierDailyCap > BigInt(0) && verifierDailyCap < two) {
      errors.verifierDailyCap = `At least two penalties: ${fmt(two)} or more.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      treasury: treasury!,
      redeemer: redeemer!,
      unbondingPeriodSeconds: unbonding!,
      minimumStake: minimumStake!,
      penaltyAmount: penaltyAmount!,
      verifierDailyCap: verifierDailyCap!,
      takeRateBps: takeRateBps!,
      slashAgentBps: slashAgentBps!,
      slashPlatformBps: slashPlatformBps!,
      slashCapBps: slashCapBps!,
    },
  };
}

/**
 * A token amount in dollars, as every other operator page writes money: the
 * settlement token is a dollar stablecoin, so "$1.00", never "1 USDG".
 */
export function dollars(raw: bigint, decimals: number): string {
  const value = Number(formatUnits(raw, decimals));
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, decimals) })}`;
}

/** One setting as people read it: "10%", "$1.00", "11 days", "0x4246…0388". */
export function paramText(key: ConfigParamKey, params: ConfigParams, asset: { decimals: number; symbol: string }): string {
  const value = params[key];
  switch (paramField(key).kind) {
    case "address":
      return String(value);
    case "percent":
      return `${Number(value) / 100}%`;
    case "money":
      return dollars(value as bigint, asset.decimals);
    case "days":
      return durationWords(Number(value));
  }
}

/** "60% to the agent, 30% to the treasury, 10% stays with the provider". */
export function splitText(params: Pick<ConfigParams, "slashAgentBps" | "slashPlatformBps">): string {
  const rest = 10_000 - params.slashAgentBps - params.slashPlatformBps;
  return `${params.slashAgentBps / 100}% to the agent, ${params.slashPlatformBps / 100}% to the treasury${rest > 0 ? `, ${rest / 100}% stays with the provider` : ""}`;
}

export interface ParamChange {
  readonly key: ConfigParamKey;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly critical: boolean;
}

/** The settings that differ, in the form's order. */
export function paramChanges(before: ConfigParams, after: ConfigParams, asset: { decimals: number; symbol: string }): ParamChange[] {
  return PARAM_FIELDS.filter((field) => String(before[field.key]).toLowerCase() !== String(after[field.key]).toLowerCase()).map((field) => ({
    key: field.key,
    label: field.label,
    // Addresses in full: the admin is asked to check them character by character.
    before: paramText(field.key, before, asset),
    after: paramText(field.key, after, asset),
    critical: field.critical === true,
  }));
}

// ── Addresses for the other doors ──────────────────────────────────────────

/** A typed address, checksummed, or the reason it is not one. */
export function parseAddress(text: string): { ok: true; address: Address } | { ok: false; error: string } {
  const value = text.trim();
  const address = checksumAddress(value);
  if (!address) return { ok: false, error: "Enter a wallet address: 0x and 40 hex characters." };
  if (value.toLowerCase() === ZERO_ADDRESS) return { ok: false, error: "The zero address cannot hold a role." };
  return { ok: true, address };
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase();
}

/** `setArbiter`: never the admin, the redeemer or a live verifier key (`InvalidArbiter`). */
export function checkNewArbiter(
  text: string,
  settings: Pick<ContractSettings, "admin" | "arbiter" | "params">,
  verifiers: readonly VerifierKeyRow[],
): { ok: true; address: Address } | { ok: false; error: string } {
  const parsed = parseAddress(text);
  if (!parsed.ok) return parsed;
  const address = parsed.address;
  if (same(address, settings.arbiter)) return { ok: false, error: "This is already the arbiter." };
  if (same(address, settings.admin)) return { ok: false, error: "The arbiter must be a different person from the admin: this is the admin's wallet." };
  if (same(address, settings.params.redeemer)) return { ok: false, error: "This is the redeemer's wallet. The arbiter must be a person's own wallet." };
  if (verifiers.some((row) => row.status === "active" && same(row.address, address))) {
    return { ok: false, error: "This is a live verifier key. The arbiter can never be a verifier." };
  }
  return { ok: true, address };
}

// ── Verifier keys ──────────────────────────────────────────────────────────

export const VERIFIER_LIFETIME_PRESETS = [30, 90, 180, 365] as const;

export interface NewVerifierForm {
  address: string;
  label: string;
  days: string;
}

export type NewVerifierCheck =
  | { ok: true; address: Address; label: string; expiresAt: bigint }
  | { ok: false; errors: Partial<Record<keyof NewVerifierForm, string>> };

/**
 * `registerVerifier`: a new address (registration is once per address, for
 * ever), never the admin or the arbiter, with a label of at most 32 bytes and
 * an expiry in the future and at most a year out.
 */
export function checkNewVerifier(
  form: NewVerifierForm,
  settings: Pick<ContractSettings, "admin" | "arbiter">,
  verifiers: readonly VerifierKeyRow[],
  nowSeconds: number,
): NewVerifierCheck {
  const errors: Partial<Record<keyof NewVerifierForm, string>> = {};
  const parsed = parseAddress(form.address);
  let address: Address | null = null;
  if (!parsed.ok) errors.address = parsed.error;
  else {
    address = parsed.address;
    const existing = verifiers.find((row) => same(row.address, address));
    if (existing) {
      errors.address =
        existing.status === "active"
          ? "This key is already registered."
          : "This address was registered before. A key is registered once, for ever: rotate to a new address.";
    } else if (same(address, settings.admin)) errors.address = "The admin's wallet can never be a verifier.";
    else if (same(address, settings.arbiter)) errors.address = "The arbiter's wallet can never be a verifier.";
  }
  const label = form.label.trim();
  if (label.length === 0) errors.label = "Name the key, e.g. where it runs: \"e2e-verifier\".";
  else if (new TextEncoder().encode(label).length > 32) errors.label = "At most 32 characters.";
  const days = Number(form.days);
  const maxDays = CONFIG_LIMITS.maxVerifierLifetimeSeconds / DAY;
  if (!/^\d+$/.test(form.days.trim()) || days < 1 || days > maxDays) errors.days = `Between 1 and ${maxDays} days.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // A year exactly from now is over the ceiling by the time the transaction lands a few seconds
  // later only if the browser clock runs ahead; an hour's margin keeps a 365-day key valid.
  const seconds = Math.min(days * DAY, CONFIG_LIMITS.maxVerifierLifetimeSeconds - 3600);
  return { ok: true, address: address!, label, expiresAt: BigInt(nowSeconds + seconds) };
}

/** "Expires in 12 days" / "Expired 3 days ago" / "Revoked". */
export function verifierStatusText(row: VerifierKeyRow, nowSeconds: number): string {
  if (row.status === "revoked") return "Revoked";
  const days = Math.round(Math.abs(row.expiresAt - nowSeconds) / DAY);
  const span = days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`;
  if (row.status === "expired") return days === 0 ? "Expired today" : `Expired ${span} ago`;
  return days === 0 ? "Expires today" : `Expires in ${span}`;
}

// ── The dispute window (`setSlashDelay`) ───────────────────────────────────

export type DelayUnit = "minutes" | "hours" | "days";

const UNIT_SECONDS: Record<DelayUnit, number> = { minutes: 60, hours: 3600, days: DAY };

/** The current window as the form shows it, in the largest whole unit. */
export function delayToForm(seconds: number): { value: string; unit: DelayUnit } {
  if (seconds % DAY === 0) return { value: String(seconds / DAY), unit: "days" };
  if (seconds % 3600 === 0) return { value: String(seconds / 3600), unit: "hours" };
  return { value: String(Math.round(seconds / 60)), unit: "minutes" };
}

export function checkSlashDelay(
  value: string,
  unit: DelayUnit,
  currentSeconds: number,
): { ok: true; seconds: number } | { ok: false; error: string } {
  if (!/^\d+$/.test(value.trim())) return { ok: false, error: "Enter a whole number." };
  const seconds = Number(value) * UNIT_SECONDS[unit];
  if (seconds < CONFIG_LIMITS.minSlashDelaySeconds || seconds > CONFIG_LIMITS.maxSlashDelaySeconds) {
    return { ok: false, error: "The contract allows 10 minutes to 22 days." };
  }
  if (seconds === currentSeconds) return { ok: false, error: "This is the current window." };
  return { ok: true, seconds };
}

/** A typed confirmation word matches, ignoring case and spaces around it. */
export function confirmWordMatches(typed: string, word: string): boolean {
  return typed.trim().toUpperCase() === word.toUpperCase();
}

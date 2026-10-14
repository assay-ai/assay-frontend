import { toFunctionSelector } from "viem";

import { KNOWN_CONTRACT_ERRORS, contractErrorNameInText, contractErrorText } from "./contract-errors";

/**
 * Naming a revert the browser meets itself — a wallet's gas estimate — by its
 * 4-byte selector, for the contract errors `contract-errors.ts` has a
 * sentence for. The selectors are pinned in the test against the ones
 * assay-backend's `abi-selectors.spec.ts` took from `cast sig`.
 */
const NAME_BY_SELECTOR: ReadonlyMap<string, string> = new Map(
  KNOWN_CONTRACT_ERRORS.map((name) => [toFunctionSelector(`${name}()`), name] as const),
);

/** The known contract error a 4-byte selector (or longer revert data) names, or `null`. */
export function contractErrorNameOfData(data: string | null | undefined): string | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8}/.test(data)) return null;
  return NAME_BY_SELECTOR.get(data.slice(0, 10).toLowerCase()) ?? null;
}

/**
 * The known contract error behind whatever a viem action threw, or `null`.
 *
 * viem wraps a node's revert in one or two of its own error classes, so this
 * walks a bounded `cause` chain: revert data (`data` as hex, or viem's decoded
 * `data.errorName`) first, then the error's own message.
 */
export function contractErrorNameOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const { data, message, cause } = current as { data?: unknown; message?: unknown; cause?: unknown };
    if (typeof data === "string") {
      const fromData = contractErrorNameOfData(data);
      if (fromData) return fromData;
    } else if (data && typeof data === "object") {
      const decoded = (data as { errorName?: unknown }).errorName;
      if (typeof decoded === "string" && contractErrorText(decoded)) return decoded;
    }
    const fromMessage = contractErrorNameInText(typeof message === "string" ? message : null);
    if (fromMessage) return fromMessage;
    current = cause;
  }
  return null;
}

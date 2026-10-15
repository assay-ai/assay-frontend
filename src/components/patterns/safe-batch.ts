/**
 * The JSON file a Safe's Transaction Builder imports ("Drag and drop a JSON
 * file"), for a call this app built but cannot sign: the arbiter's ruling or
 * block, a cancel. Pure, so the shape is tested without a browser.
 *
 * The format is the Transaction Builder's batch file: `version`, the numeric
 * `chainId` as a string, `meta`, and `transactions` of `{ to, value, data }`
 * (`contractMethod` and `contractInputsValues` null because `data` is already
 * encoded).
 */
export interface SafeBatchTransaction {
  to: string;
  /** Wei, decimal string. */
  value: string;
  /** `0x`-hex calldata. */
  data: string;
}

export interface SafeBatchInput {
  /** CAIP-2 (`eip155:46630`) or the bare number. */
  chainId: string;
  name: string;
  description?: string;
  transactions: readonly SafeBatchTransaction[];
  /** For tests. */
  createdAt?: number;
}

export interface SafeBatchFile {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: { name: string; description: string; txBuilderVersion: string };
  transactions: { to: string; value: string; data: string; contractMethod: null; contractInputsValues: null }[];
}

/** `eip155:46630` → `46630`; a bare number stays as it is. */
export function numericChainId(chainId: string): string {
  const parts = chainId.split(":");
  return parts.length >= 2 ? parts[1]! : chainId;
}

export function safeBatchFile(input: SafeBatchInput): SafeBatchFile {
  return {
    version: "1.0",
    chainId: numericChainId(input.chainId),
    createdAt: input.createdAt ?? Date.now(),
    meta: { name: input.name, description: input.description ?? "", txBuilderVersion: "1.16.5" },
    transactions: input.transactions.map((tx) => ({
      to: tx.to,
      value: tx.value,
      data: tx.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
}

/** A file name that sorts and says what it is: `assay-cancelSlashBatch-46630-2026-10-16.json`. */
export function safeBatchFileName(functionName: string, chainId: string, now: Date = new Date()): string {
  const safe = functionName.replace(/[^a-zA-Z0-9_-]/g, "");
  return `assay-${safe || "transaction"}-${numericChainId(chainId)}-${now.toISOString().slice(0, 10)}.json`;
}

/** Starts the download in the browser. No-op outside one. */
export function downloadJson(fileName: string, value: unknown): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

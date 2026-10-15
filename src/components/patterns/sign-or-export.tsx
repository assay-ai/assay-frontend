"use client";

import { Download } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

import { CopyChip } from "./copy-chip";
import { downloadJson, safeBatchFile, safeBatchFileName, type SafeBatchTransaction } from "./safe-batch";
import { SignAction, type WalletStep, type WalletStepResult } from "./sign-action";

/**
 * A transaction this app built for someone else's key — sign it here when the
 * wallet connected in this browser IS that key, otherwise hand it over as a
 * Safe batch file. One button either way; the calldata sits under
 * "Technical details", never in the body.
 *
 *   <SignOrExport
 *     canSign={walletIsArbiter}
 *     signerLabel="the arbiter (0x12…9aB)"
 *     signLabel="Sign and send the ruling"
 *     steps={[{ id: "send", label: "Cancel 2 penalties", cost: "gas", run: … }]}
 *     functionName="cancelSlashBatch"
 *     chainId="eip155:46630"
 *     transactions={[{ to, value: "0", data }]}
 *     afterExport="Import it in the Safe that holds the arbiter key and sign there. The cases move once it lands."
 *   />
 *
 * When the transaction is only built on demand (a ruling is prepared by the
 * backend from the form), pass `prepare` instead of `transactions`: the steps
 * prepare and sign in one go, and Download prepares then downloads, so
 * neither path needs a separate "Prepare" click.
 */
export interface SignOrExportProps {
  /** True when the connected wallet is the signer. */
  canSign: boolean;
  /** Who must sign, in words. */
  signerLabel: React.ReactNode;
  /** The sign button's label, a verb. */
  signLabel: string;
  steps: WalletStep[];
  onSigned?: (results: (WalletStepResult | undefined)[]) => void;
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  describeError?: (error: unknown) => string;
  /** Used for the batch file's name and title. */
  functionName: string;
  chainId: string;
  /** The calls, when already built. */
  transactions?: readonly SafeBatchTransaction[];
  /** Or: build them when Download is pressed. */
  prepare?: () => Promise<readonly SafeBatchTransaction[]>;
  /** Disable both paths (e.g. the form is not complete), with the reason. */
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  /** One sentence after the download: where to import it, and what happens then. */
  afterExport: React.ReactNode;
  /** Extra rows under Technical details (signer address, request ids…). */
  details?: readonly { label: string; value: string }[];
  className?: string;
}

export function SignOrExport({
  canSign,
  signerLabel,
  signLabel,
  steps,
  onSigned,
  successTitle,
  successDescription,
  describeError,
  functionName,
  chainId,
  transactions: given,
  prepare,
  disabled,
  disabledReason,
  afterExport,
  details = [],
  className,
}: SignOrExportProps) {
  const [downloaded, setDownloaded] = React.useState(false);
  const [prepared, setPrepared] = React.useState<readonly SafeBatchTransaction[] | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [prepareError, setPrepareError] = React.useState<string | null>(null);
  const transactions = given ?? prepared ?? [];

  const download = async () => {
    setPrepareError(null);
    let txs = given ?? null;
    if (!txs && prepare) {
      setPreparing(true);
      try {
        txs = await prepare();
        setPrepared(txs);
      } catch (error) {
        setPrepareError(describeError?.(error) ?? "The transaction could not be prepared. Nothing was downloaded.");
        return;
      } finally {
        setPreparing(false);
      }
    }
    if (!txs || txs.length === 0) return;
    downloadJson(
      safeBatchFileName(functionName, chainId),
      safeBatchFile({ chainId, name: `Assay · ${functionName}`, description: String(signLabel), transactions: txs }),
    );
    setDownloaded(true);
  };

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {canSign ? (
        <SignAction
          steps={steps}
          label={signLabel}
          disabled={disabled}
          disabledReason={disabledReason}
          onSuccess={onSigned}
          successTitle={successTitle}
          successDescription={successDescription}
          describeError={describeError}
        />
      ) : (
        <div className="flex w-full flex-col gap-2">
          <p className="text-body-13 text-02">
            This must be signed by {signerLabel}. The wallet connected here is not that key, so download the batch and
            sign it where the key lives.
          </p>
          <Button
            type="button"
            icon={<Download aria-hidden="true" />}
            onClick={() => void download()}
            loading={preparing}
            disabled={disabled}
            className="w-full tablet:w-auto tablet:self-start"
          >
            Download Safe batch
          </Button>
          <p className={cn("min-h-[18px] text-body-xs", prepareError ? "text-danger-600" : "text-02")} role="status">
            {prepareError ?? (downloaded ? afterExport : disabled ? (disabledReason ?? "") : "")}
          </p>
        </div>
      )}

      {transactions.length > 0 || details.length > 0 || canSign ? (
      <details className="group w-full rounded-md border border-01 bg-02 px-3 py-2">
        <summary className="cursor-pointer select-none text-label-13 text-02 hover:text-01">Technical details</summary>
        <dl className="mt-2 flex w-full flex-col gap-2">
          <Detail label="Function" value={functionName} />
          <Detail label="Chain" value={chainId} />
          {details.map((row) => (
            <Detail key={row.label} label={row.label} value={row.value} />
          ))}
          {transactions.map((tx, index) => (
            <React.Fragment key={index}>
              <Detail label={transactions.length > 1 ? `Contract (${index + 1})` : "Contract"} value={tx.to} />
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-body-xs text-03">Calldata</dt>
                <dd className="flex min-w-0 flex-col items-start gap-1">
                  <span className="max-h-24 w-full overflow-y-auto break-all font-mono text-mono-xs text-02">{tx.data}</span>
                  <CopyChip value={tx.data} display="Copy calldata" label="calldata" />
                </dd>
              </div>
            </React.Fragment>
          ))}
          {canSign ? (
            <div className="pt-1">
              <Button type="button" size="sm" variant="secondary" icon={<Download aria-hidden="true" />} onClick={() => void download()}>
                Download Safe batch instead
              </Button>
            </div>
          ) : null}
        </dl>
      </details>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="break-all font-mono text-mono-xs text-01">{value}</dd>
    </div>
  );
}

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  connectedSpelling,
  sendSlashContractCall,
  signerMatches,
  signerRoleLabel,
} from "@/features/chain-calls/send-contract-call";
import { isUserRejection, useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { assertContractCall, formatCallArg, type ExpectedCall } from "@/libs/chains/evm/signing-guard";

/** The pinned contracts, by the name the panel shows. */
const CONTRACT_LABEL: Record<ExpectedCall["contract"], string> = {
  escrow: "Escrow contract",
  stake: "Stake contract",
  config: "Config contract",
  token: "settlement token",
};

/**
 * One unsigned contract call the operator console built for someone else's
 * key — the arbiter's ruling or block, or the arbiter's/admin's cancel.
 *
 * The copy path is the primary one: the call is shown in full, and as the
 * JSON a Safe's Transaction Builder takes, for whichever machine or multisig
 * holds the signer. Signing here is offered ONLY when the wallet connected in
 * this browser is `signer` (case-insensitive, as EVM addresses are), and goes
 * through the same `useSigner` → `signAndSend` path as every other
 * transaction in the app. The backend never signs any of these.
 *
 * The server's `functionName` and `requestIds` are labels, and `data` is what
 * is signed (operator review 2026-10-15, F1). So the calldata is decoded here
 * against the pinned contract and must be exactly `expected` — what the
 * operator selected on this screen. The panel shows the decoded call, and
 * offers neither the wallet nor the Safe JSON when it does not match.
 */
export function ContractCallPanel({
  call,
  expected,
  title,
  afterSend,
  onSent,
}: {
  call: SlashContractCall;
  /** The call the operator chose here; anything else is refused. */
  expected: ExpectedCall;
  title: string;
  /** What happens once it lands, in a sentence: who mirrors it, and when. */
  afterSend: string;
  onSent?: (hash: string) => void;
}) {
  const connected = useConnectedAddresses();
  const signerState = useSigner({
    chainId: call.chainId,
    address: connectedSpelling(connected, call.signer),
  });
  const walletAddress = signerState.status === "ready" ? signerState.signer.address : null;
  const checked = React.useMemo(() => {
    try {
      return { decoded: assertContractCall(call, expected), refusal: null };
    } catch (e) {
      return { decoded: null, refusal: e instanceof Error ? e.message : String(e) };
    }
  }, [call, expected]);
  const decoded = checked.decoded;
  const canSignHere = decoded !== null && signerMatches(walletAddress, call);

  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);

  const safeJson = React.useMemo(
    () =>
      JSON.stringify(
        {
          chainId: call.chainId.split(":")[1] ?? call.chainId,
          transactions: [{ to: call.to, value: call.value, data: call.data }],
        },
        null,
        2,
      ),
    [call],
  );

  const send = async () => {
    if (signerState.status !== "ready") return;
    setError(null);
    setSending(true);
    try {
      const sent = await sendSlashContractCall(call, signerState.signer, expected);
      setHash(sent);
      onSent?.(sent);
    } catch (e) {
      setError(
        isUserRejection(e)
          ? "Nothing was signed — the wallet prompt was closed or declined."
          : e instanceof Error
            ? e.message.split("\n")[0]
            : "The wallet did not complete this.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-01 bg-02 p-3 tablet:p-4">
      <p className="text-label-13 text-01">{title}</p>
      {decoded === null ? (
        <p className="text-body-13 text-danger-600" role="alert">
          This is not the transaction you asked for, so it is not offered for signing or copying.{" "}
          {checked.refusal}
        </p>
      ) : (
        <>
          <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-2 tablet:grid-cols-2">
            <Row label="Function (decoded from the calldata)" value={decoded.functionName} />
            <Row label="Chain" value={call.chainId} />
            <Row label="To (contract)" value={`${decoded.to} (${CONTRACT_LABEL[decoded.contract]})`} />
            <Row label="Value" value={call.value} />
            <Row label="Must be signed by" value={call.signer} />
            <Row label="Signer role" value={`${signerRoleLabel(call.signerRole)} (${call.signerRole})`} />
          </dl>
          <div className="flex flex-col gap-0.5 text-body-xs text-02">
            <span className="text-label-13 text-02">Arguments (decoded from the calldata)</span>
            <ul className="flex flex-col gap-0.5 font-mono text-mono-12 text-01">
              {decoded.args.map((arg, i) => (
                <li key={i} className="break-all">
                  {formatCallArg(arg)}
                </li>
              ))}
            </ul>
          </div>
          <CodeBlock title={`${decoded.functionName} calldata (unsigned)`} code={call.data} />
          <CodeBlock title="Safe Transaction Builder JSON" code={safeJson} />
        </>
      )}

      {hash ? (
        <p className="text-body-13 text-02" role="status">
          Sent and mined as <span className="break-all font-mono text-mono-12 text-01">{hash}</span>. {afterSend}
        </p>
      ) : decoded === null ? null : canSignHere ? (
        <Button type="button" variant="secondary" className="self-start" loading={sending} onClick={() => void send()}>
          Sign and send with the connected wallet
        </Button>
      ) : (
        <p className="text-body-xs text-03">
          The wallet connected here is not{" "}
          <span className="break-all font-mono text-mono-12 text-02">{call.signer}</span>, so there is nothing to
          sign with. Copy the transaction above into the Safe or the wallet that holds this key, and send it from
          there. {afterSend}
        </p>
      )}
      {error ? (
        <p className="text-body-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-label-13 text-02">{label}</dt>
      <dd className="break-all font-mono text-mono-12 text-01">{value}</dd>
    </div>
  );
}

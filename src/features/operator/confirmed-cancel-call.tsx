"use client";

import * as React from "react";

import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { decodePinnedCall } from "@/libs/chains/evm/signing-guard";

import { ContractCallAction } from "./contract-call-action";

/**
 * The request id an admin/arbiter `cancelSlash` would cancel, decoded from the
 * calldata itself (never the server's label), or `null` when the calldata is
 * no single-record `cancelSlash` to the pinned stake contract.
 */
export function cancelledRequestIdOf(call: SlashContractCall): string | null {
  try {
    const decoded = decodePinnedCall(call);
    if (decoded.contract !== "stake" || decoded.functionName !== "cancelSlash") return null;
    const [id] = decoded.args;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * Frontend review N3: the case brief carries no on-chain request id to check a
 * built `cancelSlash` against, so the id decoded from the calldata is shown
 * prominently and the operator must tick that it is this case's own record
 * (as the penalties-on-chain or arbiter page shows it) before the call can be
 * signed or copied. The panel then refuses anything but that ticked id.
 */
export function ConfirmedCancelCall({
  call,
  ...action
}: { call: SlashContractCall } & Omit<React.ComponentProps<typeof ContractCallAction>, "call" | "expected">) {
  const decodedId = cancelledRequestIdOf(call);
  const [confirmed, setConfirmed] = React.useState<string | null>(null);
  const tickId = React.useId();

  if (decodedId === null) {
    return (
      <p role="alert" className="text-body-xs text-danger-700">
        This is not a cancelSlash of one record on the pinned stake contract, so it is not offered for
        signing.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full flex-col gap-1.5 rounded-md border border-warning-20 bg-warning-10 p-3">
        <span className="text-label-13 text-02">This transaction cancels the on-chain record</span>
        <span className="break-all font-mono text-mono-13 font-semibold text-01">{decodedId}</span>
        <span className="text-body-xs text-02">
          Read from the calldata itself. Check it is this case&rsquo;s own record before you sign: a
          wrong id would cancel another provider&rsquo;s penalty.
        </span>
        <label htmlFor={tickId} className="flex items-center gap-2 text-body-13 text-01">
          <input
            id={tickId}
            type="checkbox"
            className="size-4 accent-primary-600"
            checked={confirmed === decodedId}
            onChange={(event) => setConfirmed(event.target.checked ? decodedId : null)}
          />
          I checked that this request id is this case&rsquo;s record
        </label>
      </div>
      {confirmed === decodedId ? (
        <ContractCallAction
          {...action}
          call={call}
          expected={{ contract: "stake", functionName: "cancelSlash", args: [confirmed] }}
          // Remembers a downloaded file or a sent cancel for this record across reloads.
          trackIds={action.trackIds ?? [confirmed]}
        />
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { NextStepCard } from "@/components/patterns/next-step-card";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { SignOrExport } from "@/components/patterns/sign-or-export";
import { cn } from "@/utils";

/**
 * Kitchen-sink group 08b: the patterns the operator screens added —
 * NextStepCard, ApprovalFooter, ReasonChips and SignOrExport — in their states.
 */

function Spec({ name, children, className }: { name: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-03">{name}</span>
      <div className="flex w-full flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CALLDATA = `0x5f2a9c1e${"00".repeat(64)}`;

export function OperatorPatternsGallery() {
  const [now] = React.useState(() => Date.now());
  const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");

  return (
    <>
      <Spec name="next-step-card · action / waiting / done">
        <div className="flex w-full max-w-[760px] flex-col gap-3">
          <NextStepCard
            kind="action"
            title="Rule on this dispute"
            description="The provider disputed this penalty on chain. Uphold it or cancel it before 15 Nov, 14:00."
            action={{ label: "Rule on it", onClick: () => undefined }}
          />
          <NextStepCard
            kind="waiting"
            title="Nothing needed from you"
            description="The provider can dispute on chain until 18 Oct, 14:00. Undisputed, it becomes executable then."
            secondary={{ label: "Suspend penalty", onClick: () => undefined }}
          />
          <NextStepCard kind="done" title="Penalty executed" description="The stake was taken. Nothing is left to do on this penalty." />
        </div>
      </Spec>

      <Spec name="approval-footer · on a form / on a request / nobody can approve">
        <div className="flex w-full max-w-[560px] flex-col gap-3">
          <ApprovalFooter needs="a second Lead adjudicator" approvers={["Riley Brooks", "Jordan Blake"]} />
          <ApprovalFooter
            needs="a second Lead adjudicator"
            approvers={["Riley Brooks"]}
            link="/operator/approvals?id=demo"
            createdAt={iso(-20)}
            expiresAt={iso(4)}
          />
          <ApprovalFooter needs="a second Admin" approvers={[]} />
        </div>
      </Spec>

      <Spec name="reason-chips · reason + note with counter">
        <div className="w-full max-w-[560px]">
          <ReasonChips
            label="Why"
            options={[
              { value: "LEAKED_KEY", label: "Leaked key", hint: "A key or wallet was exposed." },
              { value: "FRAUD", label: "Fraud" },
              { value: "ABUSE", label: "Abuse" },
              { value: "OTHER", label: "Other", hint: "Say what happened in the note." },
            ]}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={20}
            noteMax={4096}
            errors={{ note: note.length > 0 && note.trim().length < 20 ? "Write at least 20 characters." : null }}
          />
        </div>
      </Spec>

      <Spec name="sign-or-export · signer connected / not the signer">
        <div className="flex w-full max-w-[560px] flex-col gap-4">
          <SignOrExport
            canSign
            signerLabel="the arbiter"
            signLabel="Cancel and sign"
            steps={[{ id: "rule", label: "Cancel 2 penalties", cost: "gas", run: () => wait(900) }]}
            functionName="cancelSlashBatch"
            chainId="eip155:46630"
            transactions={[{ to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c", value: "0", data: CALLDATA }]}
            afterExport="Import it in the Safe that holds the arbiter key."
          />
          <SignOrExport
            canSign={false}
            signerLabel="the arbiter (0x5B38…dC4)"
            signLabel="Cancel and sign"
            steps={[]}
            functionName="cancelSlashBatch"
            chainId="eip155:46630"
            transactions={[{ to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c", value: "0", data: CALLDATA }]}
            afterExport="Import the file in the Safe that holds the arbiter key and sign it there."
          />
        </div>
      </Spec>
    </>
  );
}

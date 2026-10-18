"use client";

import { BadgeCheck } from "lucide-react";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  CONSENT_STRINGS,
  ContinueUrlRefused,
  consentFailure,
  consentView,
  defaultAgentId,
  nameProblem,
  type ConsentRequest,
} from "@/features/oauth/consent";
import { useConsentActivation } from "@/features/oauth/frame-guard";
import { ApiError, isAccountBlockedError } from "@/libs/ApiClient";
import { cn } from "@/utils";

/** The OAUTH credential name column, as an API key's name. */
const NAME_MAX = 128;

export interface SetLimitsSlotProps {
  agentId: string;
  agentName: string;
  /** Off until the click guards arm, while a decision is in flight, or when Approve is off. */
  disabled: boolean;
  /** Approve with the name on the card, after the limits are saved. */
  approve: () => void;
}

export interface ConsentCardProps {
  request: ConsentRequest;
  now: Date;
  /** The signed-in person, as shown: an email, else a wallet address. */
  signedInAs: string | null;
  onSignOut: () => void;
  /** Approves. Resolves once the page is on its way to the app; throws the API's refusal. */
  onApprove: (body: { agentId: string; name: string }) => Promise<void>;
  /** Refuses. Same contract as `onApprove`. */
  onDeny: () => Promise<void>;
  /** The request is over (expired, unknown, already answered): the page forgets it. */
  onFinal?: () => void;
  /** "Approve and set limits", for the chosen agent. Left out where limits cannot be set. */
  setLimits?: (props: SetLimitsSlotProps) => React.ReactNode;
}

/**
 * "Connect an app to Assay" (spec §6.5): who is asking, as which agent, what it
 * will and will not be able to do, where the browser goes next, and the
 * decision. Approve and Cancel act only from a person's click on the
 * top-level page (`useConsentActivation`); nothing here approves by itself.
 */
export function ConsentCard({
  request,
  now,
  signedInAs,
  onSignOut,
  onApprove,
  onDeny,
  onFinal,
  setLimits,
}: ConsentCardProps) {
  const activation = useConsentActivation();
  const [agentId, setAgentId] = React.useState<string | null>(() => defaultAgentId(request));
  const [name, setName] = React.useState(request.suggestedName);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [agentError, setAgentError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [finalText, setFinalText] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const view = consentView(request, { agentId, now });
  const locked = !activation.armed || busy || done;

  const finish = React.useCallback(
    (text: string) => {
      setFinalText(text);
      onFinal?.();
    },
    [onFinal],
  );

  React.useEffect(() => {
    if (view.expired && !done && !finalText) finish(CONSENT_STRINGS.expired);
  }, [view.expired, done, finalText, finish]);

  const decide = async (decision: "approve" | "deny") => {
    if (locked) return;
    setError(null);
    setAgentError(null);
    if (decision === "approve") {
      const problem = nameProblem(name);
      if (problem) {
        setNameError(problem);
        return;
      }
      if (view.approveDisabled || !agentId) return;
    }
    setNameError(null);
    setBusy(true);
    try {
      if (decision === "approve") await onApprove({ agentId: agentId!, name: name.trim() });
      else await onDeny();
      setDone(true);
    } catch (caught) {
      if (caught instanceof ContinueUrlRefused) {
        finish(CONSENT_STRINGS.badRedirect);
      } else if (isAccountBlockedError(caught)) {
        setError(caught.message);
      } else {
        const failure = consentFailure(caught instanceof ApiError ? caught.code : undefined);
        if (failure.kind === "final") finish(failure.text);
        else if (failure.kind === "agent") setAgentError(failure.text);
        else if (failure.kind === "name") setNameError(failure.text);
        else setError(failure.text);
      }
    } finally {
      setBusy(false);
    }
  };

  const agentName = view.agent?.label ?? "this agent";

  return (
    <section
      aria-labelledby="consent-heading"
      className="flex w-full max-w-[560px] flex-col gap-5 rounded-xl border border-01 bg-01 p-5 tablet:p-6"
    >
      <h1 id="consent-heading" className="text-heading-md text-01">
        {CONSENT_STRINGS.heading}
      </h1>

      {finalText ? (
        <p role="status" className="text-body-sm text-01" data-testid="consent-final">
          {finalText}
        </p>
      ) : (
        <>
          {activation.framed ? (
            <Banner
              tone="danger"
              title="This page is shown inside another page, so its buttons are off."
              description="Open it in its own browser tab."
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p
                className={cn("text-label-sm", view.notVerified || request.client.builtin ? "text-warning-700" : "text-01")}
                data-testid="consent-client"
              >
                {view.client.verified ? (
                  <span className="inline-flex items-center gap-1">
                    {view.client.title}
                    <BadgeCheck aria-hidden="true" className="size-4 text-teal-600" />
                  </span>
                ) : (
                  view.client.title
                )}
              </p>
              <span className="text-body-xs text-03">{view.startedAgo}</span>
            </div>
            {view.client.kindLabel ? <p className="text-body-xs text-03">{view.client.kindLabel}</p> : null}
            {view.client.domain ? (
              <p className="text-body-13 text-02">
                <strong className="font-semibold text-01">{view.client.domain}</strong>
                {view.client.host ? <span className="block text-body-xs text-03">{view.client.host}</span> : null}
              </p>
            ) : null}
            <p className="text-body-13 text-02">{CONSENT_STRINGS.wants}</p>
          </div>

          {view.notVerified ? (
            <p
              role="note"
              className="rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700"
            >
              {view.notVerified}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            {view.showAgentPicker ? (
              <Select
                label="Agent"
                value={agentId ?? ""}
                disabled={busy || done}
                onChange={(event) => {
                  setAgentId(event.target.value);
                  setAgentError(null);
                }}
              >
                {request.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ?? "Unnamed agent"}
                    {a.active ? "" : " (paused)"}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="flex gap-3 text-body-13">
                <span className="w-14 shrink-0 text-03">Agent</span>
                <span className="font-semibold text-01">{agentName}</span>
              </p>
            )}
            <Field
              id="consent-name"
              label="Name"
              value={name}
              maxLength={NAME_MAX}
              disabled={busy || done}
              error={nameError ?? undefined}
              hint="How this app is listed in Agents & keys."
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
          </div>

          {view.replaces ? (
            <p
              data-testid="consent-replaces"
              className={cn("text-body-13", view.replaces.tone === "warning" ? "text-warning-700" : "text-02")}
            >
              {view.replaces.text}
            </p>
          ) : null}

          {[...view.agentNotes, ...(agentError && !view.agentNotes.includes(agentError) ? [agentError] : [])].map(
            (note) => (
              <p key={note} role="alert" className="text-body-13 text-warning-700">
                {note}
              </p>
            ),
          )}

          <div className="flex flex-col gap-2 text-body-13 text-02">
            <p className="text-label-13 text-01">{CONSENT_STRINGS.canDoTitle}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>
                {CONSENT_STRINGS.canDo}
                {view.limitsLine ? (
                  <span className="block font-mono text-mono-13 text-01" data-testid="consent-limits">
                    {view.limitsLine}
                  </span>
                ) : null}
              </li>
            </ul>
            <p className="text-label-13 text-01">{CONSENT_STRINGS.cannotDoTitle}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {view.cannotDo.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1 text-body-13 text-02">
            <p>{view.returnLine}</p>
            <p>{view.recencyLine}</p>
            <p className="text-body-xs text-03">
              Signed in as {signedInAs ?? "your account"} · Not you?{" "}
              <button
                type="button"
                className="font-semibold text-primary-600 hover:underline disabled:opacity-40"
                disabled={busy || done}
                onClick={onSignOut}
              >
                Sign out
              </button>
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-body-13 text-danger-600">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 tablet:flex-row">
            <Button
              type="button"
              disabled={locked || view.approveDisabled}
              loading={busy}
              onClick={() => void decide("approve")}
            >
              Approve
            </Button>
            {setLimits && agentId
              ? setLimits({
                  agentId,
                  agentName,
                  disabled: locked || view.approveDisabled,
                  approve: () => void decide("approve"),
                })
              : null}
            <Button type="button" variant="secondary" disabled={locked} onClick={() => void decide("deny")}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

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
  initialName,
  nameProblem,
  visibleName,
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
  /** Whether the click being handled may act (`useConsentActivation().canAct`). */
  canAct: () => boolean;
  /**
   * What approve will check, checked before the sheet opens and again before
   * the limits are saved: the name, the agent, and the request still open
   * (a fresh read). The reason it would fail (also shown on the card), or null.
   */
  precheck: () => Promise<string | null>;
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
  /** When the page fetched the request (`Date.now()`): the local deadline counts from it. */
  fetchedAt: number;
  /** A fresh read of the request; throws the API's refusal when it is over. */
  recheck?: () => Promise<void>;
  /**
   * Goes to the app's `continue` step after a decision this tab sent got no
   * answer and the request now reads as answered. Left out when the MCP host
   * is not configured.
   */
  onResume?: () => void;
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
  fetchedAt,
  recheck,
  onResume,
  setLimits,
}: ConsentCardProps) {
  const activation = useConsentActivation();
  const [agentId, setAgentId] = React.useState<string | null>(() => defaultAgentId(request));
  const [name, setName] = React.useState(() => initialName(request));
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [agentError, setAgentError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [finalText, setFinalText] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  // A decision went out and no answer came back: it may have been recorded.
  const [unanswered, setUnanswered] = React.useState(false);
  const [canResume, setCanResume] = React.useState(false);
  // Set synchronously, so a second click before the re-render is refused too.
  const inFlight = React.useRef(false);

  const view = consentView(request, { agentId, now, fetchedAt });
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

  const decide = async (decision: "approve" | "deny", options: { afterLimitsSaved?: boolean } = {}) => {
    if (locked || inFlight.current || !activation.canAct()) return;
    const prefix = options.afterLimitsSaved ? `${CONSENT_STRINGS.limitsSavedNotApproved} ` : "";
    setError(null);
    setAgentError(null);
    if (decision === "approve") {
      const problem = nameProblem(name);
      if (problem) {
        setNameError(problem);
        if (prefix) setError(`${prefix}${problem}`);
        return;
      }
      if (view.approveDisabled || !agentId) {
        if (prefix) setError(`${prefix}${view.agentNotes[0] ?? CONSENT_STRINGS.retry}`);
        return;
      }
    }
    setNameError(null);
    setBusy(true);
    inFlight.current = true;
    let decided = false;
    try {
      if (decision === "approve") await onApprove({ agentId: agentId!, name: visibleName(name) });
      else await onDeny();
      decided = true;
      setDone(true);
    } catch (caught) {
      if (caught instanceof ContinueUrlRefused) {
        finish(`${prefix}${CONSENT_STRINGS.badRedirect}`);
      } else if (isAccountBlockedError(caught)) {
        setError(`${prefix}${caught.message}`);
      } else {
        const code = caught instanceof ApiError ? caught.code : undefined;
        const failure = consentFailure(code);
        if (!(caught instanceof ApiError)) setUnanswered(true);
        if (failure.kind === "final") {
          // An earlier decision from this tab got no answer, and now the request
          // reads as answered: it was probably recorded, and the app is waiting.
          if (code === "OAUTH_REQUEST_ALREADY_DECIDED" && unanswered && onResume) setCanResume(true);
          finish(`${prefix}${failure.text}`);
        } else if (failure.kind === "agent") {
          setAgentError(failure.text);
          if (prefix) setError(`${prefix}${failure.text}`);
        } else if (failure.kind === "name") {
          setNameError(failure.text);
          if (prefix) setError(`${prefix}${failure.text}`);
        } else setError(`${prefix}${failure.text}`);
      }
    } finally {
      inFlight.current = decided;
      setBusy(false);
    }
  };

  const agentName = view.agent?.label ?? "this agent";

  const precheck = async (): Promise<string | null> => {
    setError(null);
    const problem = nameProblem(name);
    if (problem) {
      setNameError(problem);
      return problem;
    }
    if (view.approveDisabled || !agentId) {
      const reason = view.expired ? CONSENT_STRINGS.expired : (view.agentNotes[0] ?? CONSENT_STRINGS.retry);
      setError(reason);
      return reason;
    }
    if (recheck) {
      try {
        await recheck();
      } catch (caught) {
        const failure = consentFailure(caught instanceof ApiError ? caught.code : undefined);
        if (failure.kind === "final") finish(failure.text);
        else setError(failure.text);
        return failure.text;
      }
    }
    return null;
  };

  return (
    <section
      aria-labelledby="consent-heading"
      className="flex w-full max-w-[560px] flex-col gap-5 rounded-xl border border-01 bg-01 p-5 tablet:p-6"
    >
      <h1 id="consent-heading" className="text-heading-md text-01">
        {CONSENT_STRINGS.heading}
      </h1>

      {finalText ? (
        <>
          <p role="status" className="text-body-sm text-01" data-testid="consent-final">
            {finalText}
          </p>
          {canResume && onResume ? (
            <Button type="button" className="self-start" onClick={onResume}>
              {CONSENT_STRINGS.returnToApp}
            </Button>
          ) : null}
        </>
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
            <p
              className={cn("text-label-sm", view.client.verified ? "text-01" : "text-warning-700")}
              data-testid="consent-client"
            >
              {view.client.title}
            </p>
            {view.client.kindLabel ? <p className="text-body-xs text-03">{view.client.kindLabel}</p> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-body-13 text-02">
              {view.client.domain ? (
                <p>
                  <strong className="font-semibold text-01">{view.client.domain}</strong>
                  {view.client.host ? <span className="block text-body-xs text-03">{view.client.host}</span> : null}
                </p>
              ) : (
                <span />
              )}
              <span className="text-body-xs text-03">{view.startedAgo}</span>
            </div>
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
                  canAct: activation.canAct,
                  precheck,
                  approve: () => void decide("approve", { afterLimitsSaved: true }),
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

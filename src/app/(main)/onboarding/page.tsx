"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WalletSetupBanner } from "@/components/auth/wallet-setup-banner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import { isWalletNotLinked } from "@/features/auth/wallet-link";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { ApiError } from "@/libs/ApiClient";
import { createCredential, listAgents } from "@/services";
import { cn } from "@/utils";

/**
 * First-run onboarding (design).
 *
 * The design draws exactly ONE of the four steps — step 3, "Connect your
 * agent" — and that step's card is reproduced here word for word. Steps 1, 2
 * and 4 are drawn nowhere in the design file; their shape comes from
 * the product spec ("identity confirmed, wallet provisioned silently" / "free
 * quota and trial credit shown" / "the built-in tester runs a real FREE call"),
 * and every string on them that is not lifted from the design frame is ours.
 *
 * The credential is real. `POST /agents/{agentId}/credentials` returns its
 * secret exactly once, which is the whole point of the warning line below — so
 * it is created on an explicit click, never on mount: a page that mints a
 * durable credential just because someone opened it is a page that leaks
 * credentials into an account every time it is refreshed.
 */

const STEPS = [
  // Only step 3's label is the design's. The other three are ours.
  { n: 1, label: "Setting up your account" },
  { n: 2, label: "What you get" },
  { n: 3, label: "Connect your agent" },
  { n: 4, label: "Try a call" },
] as const;

/** The same endpoint `/connect` prints (`NEXT_PUBLIC_MCP_URL`) — never a sample host. */
function configFor(token: string): string {
  return `"x402": {
  "url": "${mcpEndpointUrl()}",
  "headers": { "Authorization": "Bearer ${token}" }
}
// This key does not expire. Revoke or rotate it at any time under Agents.`;
}

const SAMPLE_CONFIG = configFor("x402_sk_live_a91f4c2e…");

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex w-full items-center gap-2" aria-hidden="true">
      {STEPS.map((step, i) => (
        <div key={step.n} className="contents">
          {i > 0 ? (
            <span
              className={cn(
                "h-0.5 min-w-0 flex-1",
                step.n <= current ? "bg-primary-500" : "bg-04",
              )}
            />
          ) : null}
          <span
            className={cn(
              "size-[9px] shrink-0 rounded-full",
              step.n <= current ? "bg-primary-500" : "bg-04",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function Grant({ value, label, meta }: { value: string; label: string; meta: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-01 bg-02 p-[18px]">
      <p className="font-mono text-mono-xl text-01">{value}</p>
      <p className="text-body-13 text-02">{label}</p>
      <p className="font-mono text-mono-xs text-03">{meta}</p>
    </div>
  );
}

/** The design's grant pair, verbatim. Used on step 2 and again on step 3. */
function Grants() {
  return (
    <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
      <Grant value="1,000" label="free calls per day, 60 per minute" meta="resets 00:00 UTC" />
      <Grant value="$1.00" label="trial credit" meta="spendable, not withdrawable" />
    </div>
  );
}

function Tester() {
  const [query, setQuery] = useState("x402 payment protocol");
  const [ran, setRan] = useState(false);

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-02 p-[18px]">
      <p className="text-label-sm text-01">Or try a call right here, without wiring anything up</p>
      <div className="flex w-full flex-col items-stretch gap-2.5 tablet:flex-row tablet:items-end">
        <Field
          id="tester-query"
          label="search_web_preview   free · top 3 results"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          wrapperClassName="min-w-0 flex-1"
        />
        <Button
          className="shrink-0 px-4 py-2.5"
          icon={<Play />}
          onClick={() => setRan(true)}
          type="button"
        >
          Run
        </Button>
      </div>
      {ran ? (
        <Banner
          tone="warning"
          title="The in-app tester cannot run a call yet"
          description="Nothing in the API runs a tool call from the console — an agent calls tools over MCP. Use the config above, then watch the call arrive on the Overview."
        />
      ) : null}
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Bumped when the wallet finishes linking: `GET /agents` refused only for
  // want of an account, so the same call now answers.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Step 1 is "identity confirmed, wallet provisioned silently". There is no
  // provisioning endpoint; what stands in for it is the account answering at
  // all, which is exactly what `GET /agents` proves.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    listAgents({ limit: 1 })
      .then((page) => {
        if (cancelled) return;
        const first = page.items[0] as Record<string, unknown> | undefined;
        // The wire calls this `agentId`; the typed service calls it `id`.
        setAgentId((first?.agentId as string) ?? (first?.id as string) ?? null);
        setProvisioning(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError("UNKNOWN", "Your account could not be reached", 0),
        );
        setProvisioning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const create = useCallback(async () => {
    if (!agentId) return;
    setCreating(true);
    setError(null);
    try {
      const created = (await createCredential(agentId, {
        name: "First run",
      })) as { token?: string };
      setToken(created.token ?? null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError("UNKNOWN", "The credential could not be created", 0),
      );
    } finally {
      setCreating(false);
    }
  }, [agentId]);

  const current = STEPS[step - 1];

  return (
    <div className="flex w-full flex-col bg-02">
      {/*
        The design gives onboarding its own chrome — a bar carrying the GoAssay.AI
        mark, the wordmark and the step label. The buyer Top Bar above already
        carries the first two, so only the step label survives here.
      */}
      <div className="flex w-full items-center justify-end gap-2.5 border-b border-01 bg-01 px-4 py-3.5 tablet:px-7">
        <p className="text-body-13 text-02">
          Step {current.n} of {STEPS.length} — {current.label}
        </p>
      </div>

      <div className="flex w-full justify-center px-4 py-6 tablet:px-6 desktop:py-9">
        <div className="flex w-full max-w-[840px] flex-col gap-[22px] rounded-xl border border-01 bg-01 p-5 shadow-soft tablet:p-[34px]">
          <Stepper current={step} />

          {/* This is the screen a fresh signup lands on, so it is the most
              likely place to meet the wallet-link race head on. */}
          {isWalletNotLinked(error) ? (
            <WalletSetupBanner onLinked={() => setReloadNonce((n) => n + 1)} />
          ) : null}

          {error && !isWalletNotLinked(error) ? (
            <Banner
              tone="danger"
              title="Something did not complete"
              description={`${error.code} · ${error.message}`}
            />
          ) : null}

          {step === 1 ? (
            <>
              <h1 className="text-heading-lg text-01">Setting up your account</h1>
              <p className="text-body-md text-02">
                {provisioning
                  ? "This takes a few seconds. You can keep reading while it finishes."
                  : "Done. Nothing to install, no seed phrase, no chain to pick."}
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h1 className="text-heading-lg text-01">What you get</h1>
              <Grants />
              <p className="text-body-md text-02">
                Your maximum possible spend is your current balance. We cannot charge you more than
                you have deposited.
              </p>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h1 className="text-heading-lg text-01">Your account is ready.</h1>
              <Grants />

              <p className="text-label-sm text-01">Add this to your MCP client</p>
              <CodeBlock title="mcp.json" code={token ? configFor(token) : SAMPLE_CONFIG} />
              <p className="text-body-13 text-warning-600">
                This key is shown once. We cannot show it again — create a new one if you lose it.
              </p>
              {!token ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button onClick={create} loading={creating} disabled={!agentId}>
                    Create my credential
                  </Button>
                  <p className="text-body-13 text-03">
                    The block above shows a sample key until you do.
                  </p>
                </div>
              ) : null}

              <Tester />
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h1 className="text-heading-lg text-01">Try a call</h1>
              <Tester />
              <p className="text-body-md text-02">
                Every call is checked for response shape and for result-quality rules — empty
                results, dead links, stale data, missing fields. Those run on every call at every
                price. Relevance is judged on a sample, and backed by the provider&apos;s stake.
              </p>
            </>
          ) : null}

          <div className="flex w-full items-center justify-end gap-2.5">
            {step < STEPS.length ? (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/">Skip</Link>
                </Button>
                <Button
                  onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
                  disabled={step === 1 && provisioning}
                >
                  Continue
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link href="/">Go to Overview</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

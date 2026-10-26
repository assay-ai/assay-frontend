"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAgentList } from "@/features/agents/agent-list";
import * as React from "react";

import { useChainTerms } from "@/hooks/useChainTerms";
import { useChains } from "@/hooks/useChains";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import { signProofChallenge } from "@/features/provider-proof/sign-proof-challenge";
import type {
  CheckConnectivityResponse,
  ProviderPayoutAccount,
  ProviderRegistrationState,
  ProviderOnboardingStepKey,
  OnboardingStepStatus,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import {
  checkProviderConnectivity,
  createPayoutAddressChallenge,
  declareProviderEndpoint,
  provePayoutAddress,
  registerProvider,
  updateProviderRegistration,
} from "@/services";

import { accountDiffers, isTimezone, type AccountForm } from "./account-form";
import { justProvedAccountId, payoutStepIsDone, provedChainIsNew } from "./payout-accounts";
import { resolveTerms } from "./terms";
import { providerQueries } from "@/features/provider-home/queries";

/**
 * The state behind provider setup (`pM65r`, `/provider/setup`).
 *
 * ## Why "Save and continue" writes steps 1 and 4 together
 *
 * The four steps are not four independent writes, and the API is the reason:
 *
 *   - `POST /providers` **requires** `acceptedTerms` alongside the legal name,
 *     both contacts and the timezone. Step 1 and step 4 are one call; there is
 *     no route that registers without an acceptance, and none that accepts
 *     terms without registering.
 *   - `POST /providers/me/payout-address/challenge` answers
 *     `404 PROVIDER_NOT_FOUND` with no provider row (verified against the
 *     running API). Step 2 cannot start before that call succeeds.
 *   - `PUT /providers/me/endpoint` needs the row too, before it exists. See
 *     {@link canWriteEndpoint}.
 *
 * So the page shows all four cards at once, as the design draws them, and the
 * single header button performs the register (or, afterwards, the account
 * patch). Steps 2 and 3 light up when the row exists and say why while it
 * does not.
 */

export type WalletState =
  | "idle"
  | "prompting"
  | "no-wallet"
  | "address-not-connected"
  | "declined"
  | "proved"
  | "rejected";

const EMPTY_ACCOUNT: AccountForm = {
  legalName: "",
  technicalName: "",
  technicalEmail: "",
  ownerName: "",
  ownerEmail: "",
  // UTC, as the console shows every time; the provider changes it if they want deadline emails in their own zone.
  // Never read from the browser: the zone is personal data (onboarding wave item 4).
  timezone: "UTC",
};

/** A trimmed email that at least has a local part, an `@` and a dot-bearing host. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/** The chain family an address belongs to: "eip155" for 0x…, "solana" for base58. */
export function addressFamily(address: string): "eip155" | "solana" | null {
  const value = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return "eip155";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return "solana";
  return null;
}

/** The chain to prove `address` on: the agent's chain when it is that family, else the first served one. */
export function payoutChainFor(
  address: string,
  served: readonly { chainId: string; namespace: string }[],
  agentChainId: string | null,
): string | null {
  const family = addressFamily(address);
  if (!family) return null;
  if (agentChainId && agentChainId.startsWith(`${family}:`)) return agentChainId;
  return served.find((chain) => chain.namespace === family || chain.chainId.startsWith(`${family}:`))?.chainId ?? null;
}

export interface StepView {
  key: ProviderOnboardingStepKey;
  status: OnboardingStepStatus;
}

export function useProviderSetup() {
  const queryClient = useQueryClient();

  /*
    404 PROVIDER_NOT_FOUND is the STARTING STATE of this screen, not a failure.
    `retry: 0` so it is reached in one request rather than three, and
    `networkMode: "always"` so an API that is down fails instead of parking in
    `fetchStatus: "paused"` behind a spinner that never resolves.
  */
  const registrationQuery = useQuery(providerQueries.registration());

  const notFound = registrationQuery.error?.code === "PROVIDER_NOT_FOUND";
  const state = registrationQuery.data;
  const registered = Boolean(state);
  /* An error that is NOT the 404 is a real one and has to be shown. */
  const loadError = registrationQuery.error && !notFound ? registrationQuery.error : null;

  /*
    The chain the payout address is proved on. It follows the wallet: an EVM
    address (0x…) is proved on the served EVM chain, a base58 one on the
    served Solana chain — so nobody types or picks a CAIP id. When the
    session's agent row names a chain of that family it wins (it is the chain
    this organisation already pays on); otherwise the first served chain of
    that family, from `GET /chains`.
  */
  // The first agent of the shared list (`GET /agents`), not a one-row read of its own.
  const agentsQuery = useAgentList();
  const chains = useChains();
  const { terms: chainTerms } = useChainTerms();
  const first = agentsQuery.data?.items?.[0];
  const agentChainId = typeof first?.chainId === "string" ? first.chainId : null;

  const { terms, fromDesign: termsFromDesign } = resolveTerms(state?.terms, chainTerms);

  // ── step 1 · account ──────────────────────────────────────────────────

  const [account, setAccount] = React.useState<AccountForm>(EMPTY_ACCOUNT);
  const [seeded, setSeeded] = React.useState(false);

  React.useEffect(() => {
    if (seeded || !state) return;
    const r = state.registration;
    setAccount({
      legalName: r.legalName,
      technicalName: r.technicalContact.name,
      technicalEmail: r.technicalContact.email,
      ownerName: r.ownerContact.name,
      ownerEmail: r.ownerContact.email,
      timezone: r.timezone,
    });
    setSeeded(true);
  }, [state, seeded]);

  /*
    A field's refusal is shown once the person has been in it, or once they
    have asked to save — never on first paint. An empty form is not a form
    someone got wrong, and colouring six boxes red before a keystroke tells
    them nothing they did not already know.
  */
  const [touched, setTouched] = React.useState<Partial<Record<keyof AccountForm, true>>>({});
  const [attempted, setAttempted] = React.useState(false);

  function setAccountField<K extends keyof AccountForm>(key: K, value: AccountForm[K]) {
    setAccount((previous) => ({ ...previous, [key]: value }));
  }

  function touch(key: keyof AccountForm) {
    setTouched((previous) => (previous[key] ? previous : { ...previous, [key]: true }));
  }

  /** Field-level refusals, computed from the form alone. Empty = nothing wrong. */
  const accountErrors: Partial<Record<keyof AccountForm, string>> = {};
  if (account.legalName.trim() === "") accountErrors.legalName = "Enter a legal or trading name.";
  if (account.technicalName.trim() === "")
    accountErrors.technicalName = "Name the person, not a role alias.";
  if (!looksLikeEmail(account.technicalEmail))
    accountErrors.technicalEmail = "Enter an email address we can reach a person at.";
  if (account.ownerName.trim() === "")
    accountErrors.ownerName = "Name the person, not a role alias.";
  if (!looksLikeEmail(account.ownerEmail))
    accountErrors.ownerEmail = "Enter an email address we can reach a person at.";
  else if (
    looksLikeEmail(account.technicalEmail) &&
    account.ownerEmail.trim().toLowerCase() === account.technicalEmail.trim().toLowerCase()
  )
    accountErrors.ownerEmail =
      "The technical and owner contacts must be different people — this is the same inbox.";
  if (!isTimezone(account.timezone))
    accountErrors.timezone = "Enter an IANA zone name, e.g. Europe/Oslo.";

  const accountComplete = Object.keys(accountErrors).length === 0;

  /** The subset of {@link accountErrors} this person has earned the right to see. */
  const visibleAccountErrors: Partial<Record<keyof AccountForm, string>> = {};
  for (const [key, message] of Object.entries(accountErrors)) {
    if (attempted || touched[key as keyof AccountForm]) {
      visibleAccountErrors[key as keyof AccountForm] = message;
    }
  }

  // ── step 4 · terms ────────────────────────────────────────────────────

  const [accepted, setAccepted] = React.useState(false);

  React.useEffect(() => {
    if (state?.registration.acceptedTerms) setAccepted(true);
  }, [state]);

  // ── register / patch ──────────────────────────────────────────────────

  const registerMutation = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      registerProvider({
        legalName: account.legalName.trim(),
        technicalContact: {
          name: account.technicalName.trim(),
          email: account.technicalEmail.trim(),
        },
        ownerContact: { name: account.ownerName.trim(), email: account.ownerEmail.trim() },
        timezone: account.timezone.trim(),
        acceptedTerms: {
          providerAgreementVersion: terms.providerAgreementVersion,
          payoutTermsVersion: terms.payoutTermsVersion,
          slashPolicyVersion: terms.slashPolicyVersion,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider", "registration"] }),
  });

  const patchMutation = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      updateProviderRegistration({
        legalName: account.legalName.trim(),
        technicalContact: {
          name: account.technicalName.trim(),
          email: account.technicalEmail.trim(),
        },
        ownerContact: { name: account.ownerName.trim(), email: account.ownerEmail.trim() },
        timezone: account.timezone.trim(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider", "registration"] }),
  });

  const saveMutation = registered ? patchMutation : registerMutation;

  /** Why the header button is refusing, or null when it is not. */
  const saveBlockedBy: string | null = !accountComplete
    ? "Step 1 is not finished — every account field is required."
    : !accepted
      ? "Step 4 is not finished — the terms above have to be accepted."
      : null;

  /**
   * Whether step 1 holds an edit the registration does not. A registered
   * provider's "Save and continue" must save that edit, not walk past it.
   */
  const savedAccount: AccountForm | null = state
    ? {
        legalName: state.registration.legalName,
        technicalName: state.registration.technicalContact.name,
        technicalEmail: state.registration.technicalContact.email,
        ownerName: state.registration.ownerContact.name,
        ownerEmail: state.registration.ownerContact.email,
        timezone: state.registration.timezone,
      }
    : null;
  const accountDirty = accountDiffers(account, savedAccount);

  function save(onSaved?: () => void) {
    setAttempted(true);
    if (saveBlockedBy) return;
    saveMutation.mutate(undefined, { onSuccess: onSaved });
  }

  // ── step 2 · payout wallet ────────────────────────────────────────────

  const [address, setAddressValue] = React.useState("");
  const chainId = payoutChainFor(address, chains.chains, agentChainId) ?? (address.trim() === "" ? agentChainId : null);

  /*
    The address being PROVED, not "my wallet". The backend verifies the
    signature against exactly this address, so the hook has to refuse every
    other wallet — otherwise Privy's embedded wallet, which is always first in
    the list, signs and the proof fails every time.

    Trimmed here rather than in the hook: `pickWallet` matches base58 exactly,
    and the trim belongs where the person typed the value.
  */
  const signerState = useSigner({
    /*
      The chain from the registration's own first enrolment (`:129`) — the same
      value the challenge is minted with below, so the wallet is asked to sign
      for the chain the proof will be checked on. `null` until the registration
      loads, which is `chain-unknown`.
    */
    chainId,
    address: address.trim(),
  });

  const [wallet, setWallet] = React.useState<WalletState>("idle");
  const [walletDetail, setWalletDetail] = React.useState<string | null>(null);

  /*
    Editing the address retires every failure the banner is asserting.

    Each of those four sentences is a claim about the string that WAS in the
    field — "no connected wallet holds 7xKX…", "the prompt was declined" —
    and leaving one standing beside a different string asserts something that
    was never tested. `proved` and `prompting` are deliberately NOT cleared:
    `proved` is a fact about an address the platform has already accepted and
    is read back off the record, and `prompting` is a wallet dialog that is
    open right now.
  */
  const setAddress = React.useCallback((next: string) => {
    setAddressValue(next);
    setWallet((current) =>
      current === "no-wallet" ||
      current === "address-not-connected" ||
      current === "declined" ||
      current === "rejected"
        ? "idle"
        : current,
    );
  }, []);

  /*
    Facts this session has proved, held locally as well as read.

    `GET /providers/me/registration` answers with
    `Cache-Control: private, max-age=10, stale-while-revalidate=3600`
    (measured against the running API). So after a write, the refetch that
    follows it is served the PRE-WRITE body out of the browser's HTTP cache
    and revalidated in the background — for up to an hour. Invalidating the
    React Query key does not help: the request is made and the stale body
    comes back 200.

    These two values come off the write's own 201 response, and are layered
    over whatever the cached read says. A stale read can then never walk the
    screen backwards and tell someone their payout address is unproved after
    the platform has already accepted it. The header is the backend's; see
    the report.
  */
  const [provedNow, setProvedNow] = React.useState<string | null>(null);
  const [savedEndpointNow, setSavedEndpointNow] = React.useState<string | null>(null);

  /*
    Every chain this provider has proved an address on, with the ENROLMENT's
    status on each — per-chain enrolment made this a list, and the status on it is not
    decoration. Only `ACTIVE` is payable, so a proved-but-suspended chain is
    not a tick; see `payout-accounts.ts` for the rule and for why a fresh proof
    is layered over a cached read the way it is.

    This used to be `state?.registration.payoutAccountId ?? provedNow`. When the
    field became a list the left side went `undefined` rather than failing, `??`
    swallowed it, and the whole screen fell back to a value that is null until
    THIS session proves something — so a provider who proved an address last
    week was told they had not.
  */
  const payoutAccounts: ProviderPayoutAccount[] = React.useMemo(
    () => state?.registration.payoutAccounts ?? [],
    [state],
  );
  const pendingProvedAccountId = justProvedAccountId(payoutAccounts, provedNow);
  /* True only when the proof ENROLLED a chain, which is the branch the backend
     inserts `ACTIVE`. A re-proof on a chain already listed changes the address
     and nothing else — its status is whatever the list says. */
  const pendingProvedIsNewChain = provedChainIsNew(payoutAccounts, provedNow);

  const [walletAttempted, setWalletAttempted] = React.useState(false);

  /*
    Two kinds of refusal, and they are not shown at the same moment. The
    structural ones are true before anyone touches anything and are on the page
    from the start; "you have not filled the field in" is only true once
    someone has asked for the thing the field feeds.
  */
  const walletStructuralBlock: string | null = !registered
    ? "Finish step 1 first — a payout address is claimed against a provider record, and there is not one yet."
    : null;

  const walletBlockedBy: string | null =
    walletStructuralBlock ??
    (address.trim() === ""
      ? "Connect the wallet you want to be paid in first."
      : !chainId
        ? "Assay does not pay out on this wallet's network. Connect an EVM or Solana wallet."
        : null);

  const [signing, setSigning] = React.useState(false);

  async function signAndProve() {
    setWalletAttempted(true);
    if (walletBlockedBy || !chainId) return;

    /*
      The wallet is looked for BEFORE the challenge is issued. A challenge is a
      row with a nonce and an expiry; minting one for a browser that cannot
      sign leaves litter behind and tells the provider nothing they could not
      be told first.
    */

    /*
      `hydrating` is "Privy has not finished building the wallet list", not
      "there is no wallet". Return quietly and let the provider press again,
      rather than nailing the screen to a state that is false.
    */
    /*
      `chain-unknown` is NOT `no-wallet`. The chain has not been named yet
      (here: the sheet's own chain field, or a query that has not answered), so
      there is nothing for the provider to connect and no sentence about
      wallets that would be true. Return quietly; the button re-enables the
      moment a chain is known.
    */
    if (signerState.status === "chain-unknown") return;
    if (signerState.status === "hydrating") return;
    if (signerState.status === "no-wallet") {
      setWallet("no-wallet");
      return;
    }
    if (signerState.status === "address-not-connected") {
      setWallet("address-not-connected");
      return;
    }
    const signer = signerState.signer;

    /*
      Cleared HERE, not at the top.

      Above the three checks it blanked a detail that a previous attempt had
      left on screen while `wallet` stayed `rejected` — and `steps.tsx` renders
      that outcome only on `rejected && walletDetail`, so a click made during
      Privy's hydration erased the banner, set nothing, and produced no visible
      response at all. Nothing is retired until the attempt is actually going
      ahead.
    */
    setWalletDetail(null);
    setSigning(true);
    setWallet("prompting");
    try {
      const challenge = await createPayoutAddressChallenge({
        chainId,
        address: address.trim(),
      });

      /*
        `challenge.message` is handed to the wallet EXACTLY as the platform
        wrote it. The stored challenge row is the only copy `prove` verifies
        against, so building the message here would be building the one string
        that is not checked.
      */
      const proof = await provePayoutAddress({
        challengeId: challenge.challengeId,
        // Typed data on eip155, the message on Solana — see the helper.
        signature: await signProofChallenge(signer, challenge, "PAYOUT_ADDRESS"),
      });
      setProvedNow(proof.payoutAccountId);
      setWallet("proved");
      queryClient.invalidateQueries({ queryKey: ["provider", "registration"] });
    } catch (error) {
      if (error instanceof ApiError) {
        setWallet("rejected");
        setWalletDetail(error.message);
      } else if (isUserRejection(error)) {
        // The prompt was closed or declined. Nothing was proved and nothing
        // was written.
        setWallet("declined");
      } else {
        /*
          The embedded wallet and an external one throw two different error
          shapes, so the old "anything thrown means declined" folded a real
          failure into "you declined" — a sentence that is both wrong and
          impossible to act on.
        */
        setWallet("rejected");
        // `steps.tsx` only renders this outcome when `walletDetail` is
        // non-empty, so a wallet that throws with an empty message would show
        // the provider nothing at all — the same silent dead end this arm
        // exists to prevent. Never let the detail be blank.
        const detail = (error instanceof Error ? error.message : String(error)).trim();
        setWalletDetail(
          detail || "The wallet returned an error with no message. Nothing was proved.",
        );
      }
    } finally {
      setSigning(false);
    }
  }

  /**
   * The same proof as `signAndProve`, for `SignAction`: resolves once the
   * platform accepted the signature, throws otherwise (a wallet refusal is
   * rethrown as is, so the tracker says "declined" and nothing else).
   */
  async function prove(): Promise<void> {
    if (walletBlockedBy || !chainId) throw new Error(walletBlockedBy ?? "Connect the wallet you want to be paid in first.");
    if (signerState.status === "hydrating" || signerState.status === "chain-unknown") {
      throw new Error("Your wallet is still loading. Try again in a moment.");
    }
    if (signerState.status !== "ready") {
      throw new Error("That wallet is not connected in this browser. Connect it, then sign again.");
    }
    setWallet("prompting");
    try {
      const challenge = await createPayoutAddressChallenge({ chainId, address: address.trim() });
      const proof = await provePayoutAddress({
        challengeId: challenge.challengeId,
        signature: await signProofChallenge(signerState.signer, challenge, "PAYOUT_ADDRESS"),
      });
      setProvedNow(proof.payoutAccountId);
      setWallet("proved");
      await queryClient.invalidateQueries({ queryKey: ["provider", "registration"] });
    } catch (error) {
      setWallet(isUserRejection(error) ? "declined" : "rejected");
      throw error;
    }
  }

  // ── step 3 · endpoint ─────────────────────────────────────────────────

  const [endpoint, setEndpoint] = React.useState("");
  const [probe, setProbe] = React.useState<CheckConnectivityResponse | null>(null);

  React.useEffect(() => {
    const saved = state?.registration.endpoint;
    if (saved) setEndpoint((current) => (current === "" ? saved : current));

    /*
      `lastConnectivityCheck` is the latest probe of ANY endpoint this
      provider has declared — including one they have since replaced. Showing
      it under a field holding a different URL reads as a verdict on the URL
      in front of you, which it is not, so it is only adopted when the two
      agree.
    */
    const last = state?.lastConnectivityCheck;
    if (last && saved && last.endpoint === saved) setProbe((current) => current ?? last);
  }, [state]);

  const checkMutation = useMutation<CheckConnectivityResponse, ApiError, string>({
    mutationFn: (value) => checkProviderConnectivity(value),
    onSuccess: (result) => setProbe(result),
  });

  /*
    An endpoint is a column on the provider record, and step 1 is what creates
    that record — there is no route that stores one before it exists. Gating
    the button on it here, rather than letting the submit hit
    `404 PROVIDER_NOT_FOUND`, makes the refusal pre-flight: said before the
    click, not after.
  */
  const canWriteEndpoint = registered;

  const declareMutation = useMutation<CheckConnectivityResponse, ApiError, string>({
    mutationFn: (value) => declareProviderEndpoint(value),
    onSuccess: (result) => {
      setProbe(result);
      setSavedEndpointNow(result.endpoint);
      // Write the saved value into the cache instead of invalidating: the
      // refetch would be served the pre-write body from the HTTP cache.
      queryClient.setQueryData<ProviderRegistrationState>(["provider", "registration"], (old) =>
        old ? { ...old, registration: { ...old.registration, endpoint: result.endpoint } } : old,
      );
    },
  });

  const [endpointAttempted, setEndpointAttempted] = React.useState(false);

  const endpointBlockedBy: string | null =
    endpoint.trim() === "" ? "Enter the endpoint you want us to call." : null;

  function check() {
    setEndpointAttempted(true);
    if (endpointBlockedBy) return;
    checkMutation.reset();
    declareMutation.reset();
    checkMutation.mutate(endpoint.trim());
  }

  function declare() {
    if (endpointBlockedBy || !canWriteEndpoint) return;
    checkMutation.reset();
    declareMutation.reset();
    declareMutation.mutate(endpoint.trim());
  }

  // ── step statuses ─────────────────────────────────────────────────────

  /*
    The server derives all four (`GET /providers/me/registration`), and it is
    authoritative wherever it answers. It cannot answer before registration,
    so the pre-registration column is derived here from the same rules.
  */
  // The value saved in this session wins: the cached read can be a stale body.
  const savedEndpoint = savedEndpointNow ?? state?.registration.endpoint ?? null;

  const readSteps: StepView[] = state
    ? state.steps.map((s) => ({ key: s.key, status: s.status }))
    : [
        { key: "account", status: accountComplete ? "IN_PROGRESS" : "NOT_STARTED" },
        { key: "payoutWallet", status: "NOT_STARTED" },
        {
          key: "endpoint",
          status: probe?.outcome === "REACHABLE" ? "IN_PROGRESS" : "NOT_STARTED",
        },
        { key: "terms", status: accepted ? "IN_PROGRESS" : "NOT_STARTED" },
      ];

  /*
    The server's own rules, applied to the facts this session holds that the
    cached read may not carry yet. `payoutWallet` is DONE once a chain is
    proved AND its enrolment is payable — a proved address on a `SUSPENDED`
    enrolment is not a tick, see `payout-accounts.ts`; `endpoint` is DONE only
    when the saved endpoint is also the one the latest probe found REACHABLE —
    a stale check against an endpoint since changed must not read as done.
  */
  const steps: StepView[] = readSteps.map((step) => {
    if (step.key === "payoutWallet" && payoutStepIsDone(payoutAccounts, provedNow)) {
      return { ...step, status: "DONE" };
    }
    if (
      step.key === "endpoint" &&
      savedEndpoint &&
      probe?.outcome === "REACHABLE" &&
      probe.endpoint === savedEndpoint
    ) {
      return { ...step, status: "DONE" };
    }
    return step;
  });

  const currentStep = state?.currentStep ?? steps.findIndex((s) => s.status !== "DONE") + 1;
  const totalSteps = state?.totalSteps ?? steps.length;
  const allDone = steps.every((s) => s.status === "DONE");

  return {
    // load
    loading: registrationQuery.isPending,
    loadError,
    registered,
    state,
    // step 1
    account,
    setAccountField,
    accountErrors: visibleAccountErrors,
    touch,
    attempted,
    accountComplete,
    // step 4
    terms,
    termsFromDesign,
    accepted,
    setAccepted,
    // save
    save,
    accountDirty,
    saveBlockedBy,
    saving: saveMutation.isPending,
    saveError: saveMutation.error ?? null,
    saved: saveMutation.isSuccess,
    // step 2
    address,
    setAddress,
    wallet,
    walletDetail,
    walletBlockedBy,
    walletStructuralBlock,
    walletAttempted,
    signing,
    signAndProve,
    prove,
    payoutAccounts,
    pendingProvedAccountId,
    pendingProvedIsNewChain,
    chainId,
    // step 3
    endpoint,
    setEndpoint,
    savedEndpoint,
    probe,
    check,
    declare,
    /** Saves the endpoint (the server re-checks it first) and resolves with the result. */
    declareAsync: (value: string) => {
      checkMutation.reset();
      return declareMutation.mutateAsync(value);
    },
    checking: checkMutation.isPending,
    declaring: declareMutation.isPending,
    checkError: (checkMutation.error ?? declareMutation.error) as ApiError | null,
    endpointBlockedBy,
    endpointAttempted,
    canWriteEndpoint,
    // progress
    steps,
    currentStep,
    totalSteps,
    allDone,
  };
}

export type ProviderSetup = ReturnType<typeof useProviderSetup>;

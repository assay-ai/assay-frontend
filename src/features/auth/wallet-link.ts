"use client";

import { useSyncExternalStore } from "react";

import { ApiError, onWalletNotLinked } from "@/libs/ApiClient";
import { linkWallet } from "@/services/auth.service";

/**
 * The first minute of a brand-new account, made visible and then made short.
 *
 * ## The condition
 *
 * Privy issues the access token BEFORE it records the wallet — 1–2 seconds for
 * an external wallet signing in with SIWS, longer for an embedded one, which is
 * created client-side after the token exists. The API's login path looks the
 * identity up in that gap, truthfully finds no Solana wallet, and holds a
 * 60-second cooldown before it will look again. Every request in between
 * answers `AUTH_WALLET_NOT_LINKED` (424) — to an account that was provisioned
 * correctly.
 *
 * ## Two halves, and only one of them is cosmetic
 *
 * 1. `POST /auth/wallet/link` asks the API to look again NOW. This is what
 *    actually removes the wait; the browser is the only party that knows when
 *    the wallet appeared.
 * 2. This store lets a screen render "setting up your wallet" instead of a red
 *    "could not be loaded", and reload itself the moment the link lands.
 *
 * ## What it deliberately does NOT do
 *
 * It does not observe 424s, and it does not gate any screen. The previous
 * attempt did both: a `WalletProvisioningGate` replaced `children` and cleared
 * itself on a 424 counter, and it never once activated in a browser — the
 * handler registered in a `useEffect` that ran after the burst it was meant to
 * catch, and unmounting `children` made the queries it wanted to refetch
 * inactive. This starts from Privy's own login event instead, so there is no
 * burst to race, and every screen stays mounted.
 */
export type WalletLinkStatus =
  /** Signed out, or nothing has asked yet. */
  | "idle"
  /** The API says there is still no wallet on the row; we are asking again. */
  | "provisioning"
  /** `primary_account_id` is set. Everything works from here. */
  | "linked"
  /**
   * Terminal: the deadline passed, or the API refused for a reason retrying
   * cannot fix. A person has to do something (link a wallet, or ask support).
   */
  | "unavailable";

/**
 * Matches the API's floor for a client-triggered lookup
 * (`WALLET_REFRESH_COOLDOWN_MS`, 3s). Polling faster is not rewarded: a call
 * inside that window is answered from the API's cooldown map without reaching
 * Privy at all.
 */
const POLL_INTERVAL_MS = 3_000;

/**
 * When to stop and say so. Long enough to cover a slow embedded-wallet
 * creation, short enough that "setting up your wallet" is never a lie — an
 * identity with no Solana wallet at all (a user who dismissed the wallet step)
 * never resolves, and must be told rather than spun at.
 */
const DEADLINE_MS = 60_000;

let status: WalletLinkStatus = "idle";
let timer: ReturnType<typeof setTimeout> | null = null;
let deadlineAt = 0;
let inFlight = false;

const listeners = new Set<() => void>();

/**
 * ## When the link landing refetches the screens
 *
 * Only when a screen was actually refused for want of a wallet. A screen that
 * mounted before the wallet linked is holding a failed request, so the link
 * landing has to refetch it (`PrivySessionBridge`). But every session-guarded
 * route refuses an unlinked account with `AUTH_WALLET_NOT_LINKED`; none
 * answers successfully with "no wallet yet" data. So when no request got that
 * refusal, nothing on screen depends on the link, and refetching the whole
 * cache once it lands is the same data fetched again. That is every reload of
 * an account linked long ago: the link answers `linked` at once, and used to
 * refetch every query a second time for it.
 *
 * - `refusedBeforeLink`: a refusal arrived while the link had not landed. Kept
 *   across `resetWalletLink`, which also runs when Privy first resolves the
 *   identity, after the burst that may have been refused. A refusal kept from
 *   an earlier identity costs one extra refetch, nothing more.
 * - `lateRefusalArmed`: a request sent before the link landed may still come
 *   back refused after it (the API decided it before the link was written).
 *   That holds whether or not something was refused before: a refetch at the
 *   moment the link lands does not restart a query still fetching with no
 *   data, it waits on the same request, and so ends with the same late 424.
 *   The first late refusal refetches once; later ones change nothing, so a
 *   424 can never start a loop.
 *
 * A late refusal is reported from inside `ApiClient`'s response handler,
 * while its query is still fetching: a refetch started there would join that
 * request and settle with the 424 too. So it is started on the next task,
 * once the refused request has settled.
 */
let refusedBeforeLink = false;
let lateRefusalArmed = false;
const refetchListeners = new Set<() => void>();

function refetchScreens(): void {
  for (const listener of refetchListeners) listener();
}

function landed(): void {
  lateRefusalArmed = true;
  if (refusedBeforeLink) {
    refusedBeforeLink = false;
    refetchScreens();
  }
}

/** `ApiClient` saw an `AUTH_WALLET_NOT_LINKED`. */
export function noteWalletNotLinked(): void {
  if (status !== "linked") {
    refusedBeforeLink = true;
    return;
  }
  if (!lateRefusalArmed) return;
  lateRefusalArmed = false;
  setTimeout(refetchScreens, 0);
}

onWalletNotLinked(noteWalletNotLinked);

/** Forgets every refusal seen so far. For tests. */
export function forgetWalletRefusals(): void {
  refusedBeforeLink = false;
  lateRefusalArmed = false;
}

/**
 * Called when the screens must be refetched because the link landed after
 * something was refused for want of it. See "When the link landing refetches
 * the screens" above.
 */
export function subscribeLinkedRefetch(listener: () => void): () => void {
  refetchListeners.add(listener);
  return () => {
    refetchListeners.delete(listener);
  };
}

function emit(next: WalletLinkStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener();
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

async function attempt(): Promise<void> {
  // React 18 StrictMode mounts effects twice in development, and a screen may
  // ask for a retry while one is already out. One request at a time.
  if (inFlight) return;
  inFlight = true;
  let delay = POLL_INTERVAL_MS;

  try {
    const result = await linkWallet();
    if (result.linked) {
      clearTimer();
      emit("linked");
      landed();
      return;
    }
    emit("provisioning");
  } catch (error) {
    // A rate limit is "not now", not "never": ask again once the API's wait is
    // over (never sooner than the usual interval), inside the same deadline.
    if (error instanceof ApiError && error.status === 429) {
      delay = Math.max(POLL_INTERVAL_MS, (error.retryAfterSeconds ?? 0) * 1000);
    } else if (error instanceof ApiError && error.status !== 0 && error.status !== 424) {
      // 401 is a dead session: `ApiClient`'s own handler is already signing
      // this browser out, and another attempt would only add a second
      // redirect. Anything else with a status is the API refusing on purpose
      // (403 for a suspended tenant) — terminal, because polling cannot
      // change it.
      clearTimer();
      emit(error.status === 401 ? "idle" : "unavailable");
      return;
    }
    // A transport failure or a rate limit: keep the schedule below and try again.
    emit("provisioning");
  } finally {
    inFlight = false;
  }

  schedule(delay);
}

function schedule(delay: number = POLL_INTERVAL_MS): void {
  clearTimer();
  if (status === "linked") return;

  if (Date.now() >= deadlineAt) {
    emit("unavailable");
    return;
  }

  timer = setTimeout(() => {
    void attempt();
  }, delay);
}

/**
 * Called once per login, by `PrivySessionBridge`, as soon as the access token
 * is stored — anything earlier would send the request unauthenticated.
 *
 * The first attempt is immediate and usually lands inside the API's 3s
 * cooldown (the login burst has just spent a lookup), so the one that links is
 * typically the second, about three seconds in. That is the whole wait now.
 */
export function startWalletLink(): void {
  // Already linked: the row cannot go back to unlinked, so there is nothing
  // to ask about.
  if (status === "linked") return;

  deadlineAt = Date.now() + DEADLINE_MS;
  emit("provisioning");
  void attempt();
}

/** Logout, or an identity change. Everything about the previous person goes. */
export function resetWalletLink(): void {
  clearTimer();
  deadlineAt = 0;
  lateRefusalArmed = false;
  emit("idle");
}

/** The "Try again" on the banner, after the deadline gave up. */
export function retryWalletLink(): void {
  startWalletLink();
}

export function getWalletLinkStatus(): WalletLinkStatus {
  return status;
}

export function subscribeWalletLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server render has no browser and no session: always `idle`. */
function serverSnapshot(): WalletLinkStatus {
  return "idle";
}

export function useWalletLink(): WalletLinkStatus {
  return useSyncExternalStore(subscribeWalletLink, getWalletLinkStatus, serverSnapshot);
}

/**
 * Whether a failed request failed *only* because no wallet is linked yet.
 *
 * Checked on the code rather than the status because the code is the contract
 * — `AUTH_WALLET_NOT_LINKED` is what the API's error catalogue promises, and a
 * status is one interceptor away from being rewritten.
 */
export function isWalletNotLinked(error: unknown): boolean {
  return error instanceof ApiError && error.code === "AUTH_WALLET_NOT_LINKED";
}

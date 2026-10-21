"use client";

import * as React from "react";

import { ApiError, TOO_MANY_REQUESTS } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";

/*
  One shared one-second clock, running only while some sentence counts down.
  Subscribing reads the time again, so a 429 that arrives after a long idle
  never starts from a stale instant.
*/
const clock = { now: Date.now(), listeners: new Set<() => void>(), timer: null as ReturnType<typeof setInterval> | null };

function subscribeClock(listener: () => void): () => void {
  clock.listeners.add(listener);
  clock.now = Date.now();
  if (!clock.timer) {
    clock.timer = setInterval(() => {
      clock.now = Date.now();
      clock.listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer);
      clock.timer = null;
    }
  };
}

const noSubscription = () => () => {};
const readClock = () => clock.now;

/**
 * The plain sentence for an error that stays on screen. A 429 counts down,
 * once a second, to the end of the wait its `Retry-After` named (`retryAt`),
 * so the seconds shown always match the header and the client's own
 * cooldown; any other error is `plainApiError` as it was.
 *
 * `fallback` is the sentence for something that is not an `ApiError`
 * (a network failure); default `plainError("ERR_NETWORK")`.
 */
export function useApiErrorSentence(error: unknown, fallback?: string): string {
  const counting = error instanceof ApiError && error.code === TOO_MANY_REQUESTS && typeof error.retryAt === "number";
  const now = React.useSyncExternalStore(counting ? subscribeClock : noSubscription, readClock, readClock);
  if (error instanceof ApiError) {
    if (!counting) return plainApiError(error);
    /*
      The shared clock may still hold an old tick on the first render after a
      long idle (it refreshes on subscribe). The error's own arrival
      (`retryAt` − `retryAfterSeconds`) is a floor, so the wait shown is never
      larger than the one the header named (review M5).
    */
    const arrived = error.retryAt! - (error.retryAfterSeconds ?? 0) * 1000;
    return plainApiError(error, Math.max(now, arrived));
  }
  return fallback ?? plainError("ERR_NETWORK");
}

export function ApiErrorSentence({ error, fallback }: { error: unknown; fallback?: string }) {
  return <>{useApiErrorSentence(error, fallback)}</>;
}

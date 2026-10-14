/**
 * The operator console's session: `{ token, expiresAt }` from
 * `POST /operator/auth/verify`.
 *
 * A second, deliberately separate authentication path — `OperatorAuthGuard` on
 * the backend, not Privy. It lives under its own storage key, never under the
 * buyer and provider `accessToken`, so signing out of one does not clear the
 * other and neither token can be presented where the other is expected.
 *
 * SSR-safe and storage-error-safe like the Privy accessors in `ApiClient.ts`:
 * this module is imported by `src/services/operator-api.ts`, which a Server
 * Component may reach.
 */
export const OPERATOR_SESSION_KEY = "operatorSession";

/** The pasted-token key of the console's first version. Removed on sight. */
const LEGACY_TOKEN_KEY = "operatorAccessToken";

export interface OperatorSessionRecord {
  readonly token: string;
  /** ISO 8601, as the verify answered it. */
  readonly expiresAt: string;
}

/** Why a session ended, so the sign-in screen can say so. */
export type OperatorSessionEnd = "signed-out" | "expired" | "refused";

type Listener = (end: OperatorSessionEnd | null) => void;

const listeners = new Set<Listener>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function parse(raw: string | null): OperatorSessionRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OperatorSessionRecord> | null;
    if (!value || typeof value.token !== "string" || typeof value.expiresAt !== "string") return null;
    if (value.token.length === 0 || Number.isNaN(Date.parse(value.expiresAt))) return null;
    return { token: value.token, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/**
 * The stored session, or `null` when there is none or it has expired. An
 * expired or unreadable one is removed, so the next screen prompts instead of
 * sending a token the backend will refuse.
 */
export function readOperatorSession(now: number = Date.now()): OperatorSessionRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    store.removeItem(LEGACY_TOKEN_KEY);
    const raw = store.getItem(OPERATOR_SESSION_KEY);
    const record = parse(raw);
    if (raw !== null && (!record || Date.parse(record.expiresAt) <= now)) {
      store.removeItem(OPERATOR_SESSION_KEY);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** The bearer token for operator calls only, or `null`. */
export function getOperatorToken(now: number = Date.now()): string | null {
  return readOperatorSession(now)?.token ?? null;
}

export function saveOperatorSession(record: OperatorSessionRecord): void {
  const store = storage();
  if (store) {
    try {
      store.setItem(OPERATOR_SESSION_KEY, JSON.stringify({ token: record.token, expiresAt: record.expiresAt }));
    } catch {
      /* storage disabled; the next request 401s and the shell re-prompts */
    }
  }
  notify(null);
}

/** Drops the session and tells the shell why. Idempotent. */
export function clearOperatorSession(end: OperatorSessionEnd = "signed-out"): void {
  const store = storage();
  if (store) {
    try {
      store.removeItem(OPERATOR_SESSION_KEY);
      store.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      /* nothing to do */
    }
  }
  notify(end);
}

/**
 * Called with `null` when a session is saved and with the reason when one
 * ends. The console shell subscribes, so a 401 on any operator call — not
 * only `/operator/me` — sends the operator back to sign-in.
 */
export function subscribeOperatorSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(end: OperatorSessionEnd | null): void {
  for (const listener of listeners) listener(end);
}

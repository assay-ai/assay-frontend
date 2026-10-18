/**
 * Whether the provider console may draw its shell yet.
 *
 * Purely visual: it decides only whether the sidebar and the screens are
 * drawn or a neutral loader is. It signs nobody in or out and sends nobody
 * anywhere — the session bridge and the API's 401 still do all of that,
 * exactly as before — so a signed-out visitor sees the loader, not a flash
 * of "Welcome" and the sidebar, until the 401 takes them to sign-in.
 *
 * Drawn when Privy has settled on a signed-in person, or when a session token
 * is stored (the client sends it whether or not Privy holds a session, so the
 * console must keep working for it), and always on a demo build, which has
 * no session at all.
 *
 * Never forever: after {@link SHELL_GATE_TIMEOUT_MS} the page renders as it
 * did before the gate (a Privy that never settles, an unreachable API), and
 * a dead session still 401-redirects from there.
 */
export const SHELL_GATE_TIMEOUT_MS = 8_000;

export function consoleShellReady(input: {
  demo: boolean;
  /** Privy's `ready`. */
  ready: boolean;
  /** Privy's `authenticated`. */
  authenticated: boolean;
  /** A session token is in storage (`getSessionToken() !== null`). */
  storedToken: boolean;
  /** {@link SHELL_GATE_TIMEOUT_MS} has passed since the shell mounted. */
  timedOut?: boolean;
}): boolean {
  if (input.demo || input.timedOut) return true;
  if (!input.ready) return false;
  return input.authenticated || input.storedToken;
}

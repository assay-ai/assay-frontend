import type { ProviderRegistrationState } from "@/interfaces";

/**
 * The buyer app's way into the provider side (onboarding wave 2, item 1).
 *
 * A signed-in buyer had no path to provider setup: it was only linked from
 * the public pages. The account menu, Overview and Explore now offer it, and
 * stay quiet for someone who is already a provider ("Provider console").
 *
 *   not registered (404)          List your API          /provider/setup
 *   registered, setup not done    Finish provider setup  /provider/setup
 *   registered, setup done        Provider console       /provider
 *
 * `null` while the registration is unknown (loading, signed out, or an error
 * other than the 404): an entry that flips from one label to another on load
 * is worse than one that appears a moment later.
 */
export interface ProviderEntry {
  /** True once this account has a provider row. */
  provider: boolean;
  label: string;
  href: string;
}

export const LIST_YOUR_API: ProviderEntry = { provider: false, label: "List your API", href: "/provider/setup" };

export function providerEntryFor(input: {
  state: Pick<ProviderRegistrationState, "steps"> | undefined;
  notRegistered: boolean;
}): ProviderEntry | null {
  if (input.notRegistered) return LIST_YOUR_API;
  if (!input.state) return null;
  const done = input.state.steps.length > 0 && input.state.steps.every((step) => step.status === "DONE");
  return done
    ? { provider: true, label: "Provider console", href: "/provider" }
    : { provider: true, label: "Finish provider setup", href: "/provider/setup" };
}

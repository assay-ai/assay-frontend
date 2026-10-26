import type { ProviderContact } from "@/interfaces";

import type { AccountForm } from "./account-form";

/**
 * The second contact (`ownerContact`, onboarding wave 2 item 5).
 *
 * Optional at sign-up, so a solo developer can register and list free tools;
 * required before a PAID (or freemium) listing is published — the backend's
 * publish gate asks it as `SECOND_CONTACT` (`PROVIDER_SECOND_CONTACT_REQUIRED`).
 * It is an escalation inbox only: nobody signs in as it, and it recovers
 * nothing, so leaving it out at sign-up weakens no security.
 */
export const SECOND_CONTACT_PROMPT =
  "Paid tools need a second contact: someone we can reach when you are away, with a different inbox.";

/** Whether the form names a second contact at all (either box typed in). */
export function secondContactGiven(form: Pick<AccountForm, "ownerName" | "ownerEmail">): boolean {
  return form.ownerName.trim() !== "" || form.ownerEmail.trim() !== "";
}

/**
 * Whether the Go live step must ask for a second contact now: the publish
 * check says so, or the listing charges and the registration has none.
 * `ownerContact` undefined = the registration is not read yet (no prompt).
 */
export function needsSecondContact(input: {
  paid: boolean;
  ownerContact: ProviderContact | null | undefined;
  gateUnmet: boolean;
}): boolean {
  return input.gateUnmet || (input.paid && input.ownerContact === null);
}

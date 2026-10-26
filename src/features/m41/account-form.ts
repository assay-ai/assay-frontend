import { secondContactGiven } from "./second-contact";

/** Step 1's six fields, as typed. */
export interface AccountForm {
  legalName: string;
  technicalName: string;
  technicalEmail: string;
  ownerName: string;
  ownerEmail: string;
  timezone: string;
}

/**
 * Whether the form holds an edit the server does not have yet.
 *
 * Trimmed on both sides, because that is what a save sends. `saved` is the
 * form as seeded from the registration, or `null` before one exists.
 */
export function accountDiffers(form: AccountForm, saved: AccountForm | null): boolean {
  if (!saved) return true;
  return (Object.keys(form) as (keyof AccountForm)[]).some(
    (key) => form[key].trim() !== saved[key].trim()
  );
}

/** Whether this runtime knows `value` as a time zone ("Europe/Oslo", "UTC"); "Mars/Base" is refused. */
export function isTimezone(value: string): boolean {
  const zone = value.trim();
  if (zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A trimmed email that at least has a local part, an `@` and a dot-bearing host. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/**
 * Field-level refusals, computed from the form alone. Empty = nothing wrong.
 *
 * The second contact is optional at sign-up (it is asked before a paid
 * listing goes live). Once either box is typed in — or once the registration
 * holds one, which can be replaced but not removed — both are checked, and
 * its inbox must differ from the main contact's.
 */
export function accountErrorsOf(account: AccountForm, savedSecondContact: boolean): Partial<Record<keyof AccountForm, string>> {
  const errors: Partial<Record<keyof AccountForm, string>> = {};
  if (account.legalName.trim() === "") errors.legalName = "Enter a legal or trading name.";
  if (account.technicalName.trim() === "") errors.technicalName = "Name the person, not a role alias.";
  if (!looksLikeEmail(account.technicalEmail)) errors.technicalEmail = "Enter an email address we can reach a person at.";
  if (secondContactGiven(account) || savedSecondContact) {
    if (account.ownerName.trim() === "") errors.ownerName = "Name the person, not a role alias.";
    if (!looksLikeEmail(account.ownerEmail)) errors.ownerEmail = "Enter an email address we can reach a person at.";
    else if (
      looksLikeEmail(account.technicalEmail) &&
      account.ownerEmail.trim().toLowerCase() === account.technicalEmail.trim().toLowerCase()
    )
      errors.ownerEmail = "The technical and owner contacts must be different people — this is the same inbox.";
  }
  if (!isTimezone(account.timezone)) errors.timezone = "Enter an IANA zone name, e.g. Europe/Oslo.";
  return errors;
}

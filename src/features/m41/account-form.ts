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

/**
 * Where a person reaches a human at Assay, when this deployment has one
 * (`NEXT_PUBLIC_SUPPORT_URL`: a mailto: or a help-desk URL). Screens show a
 * "Contact support" link only when it is set — never a "contact support"
 * sentence with nowhere to go.
 */
export const SUPPORT_URL: string | null = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim() || null;

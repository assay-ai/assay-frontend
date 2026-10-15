"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";
import { routes } from "@/libs/routes";

/**
 * Retired: leaving is the Stake page's "Getting your stake back" section, which
 * says what pausing and withdrawing do before the Withdraw sheet opens.
 */
export default function ExitRedirect() {
  return <ClientRedirect to={`${routes.stake()}#leaving`} keepQuery={false} />;
}

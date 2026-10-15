"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/**
 * Retired: nothing can be decided in an approval queue yet, and no screen
 * links here. What stops a call now is on Spending limits, so an old link
 * lands there.
 */
export default function ApprovalsPage() {
  return <ClientRedirect to="/limits" keepQuery={false} />;
}

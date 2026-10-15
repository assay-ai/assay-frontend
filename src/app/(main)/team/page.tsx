"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/**
 * Retired: there are no invites yet, and the limits this page showed now
 * live on Spending limits, so an old link lands there.
 */
export default function TeamPage() {
  return <ClientRedirect to="/limits" keepQuery={false} />;
}

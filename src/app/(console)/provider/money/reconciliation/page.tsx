"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: reconciliation is the Money page's CSV and its "Explain a difference" drawer. */
export default function ReconciliationRedirect() {
  return <ClientRedirect to="/provider/money?explain=1" keepQuery={false} />;
}

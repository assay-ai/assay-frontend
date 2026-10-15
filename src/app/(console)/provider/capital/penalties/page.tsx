"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: penalties have their own page with Needs action / Disputed / Closed tabs. */
export default function CapitalPenaltiesRedirect() {
  return <ClientRedirect to="/provider/penalties" keepQuery={false} />;
}

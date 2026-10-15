"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: disputes are the Disputed tab of the Penalties page. */
export default function DisputesRedirect() {
  return <ClientRedirect to="/provider/penalties?tab=disputed" keepQuery={false} />;
}

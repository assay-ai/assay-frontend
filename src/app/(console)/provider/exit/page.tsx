"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";
import { routes } from "@/libs/routes";

/** Retired: leaving is the "Withdraw stake" sheet on the Stake page. */
export default function ExitRedirect() {
  return <ClientRedirect to={routes.stake("withdraw")} keepQuery={false} />;
}

"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";
import { routes } from "@/libs/routes";

/** The nav calls it "Stake"; the page lives at /provider/capital. Keeps `?sheet=` so a link can open a sheet. */
export default function StakeRedirect() {
  return <ClientRedirect to={routes.stake()} />;
}

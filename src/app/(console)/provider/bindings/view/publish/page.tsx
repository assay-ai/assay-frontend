"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";
import { RETIRED_BINDING_PAGES } from "@/features/provider-binding/screens";

/** Retired: this page now lives in the listing's three tabs or the wizard. Keeps `?binding=`. */
export default function RetiredBindingPage() {
  return <ClientRedirect to={RETIRED_BINDING_PAGES["publish"]!} />;
}

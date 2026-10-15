"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** The nav says "Penalties"; the list lives at /operator/cases. Keeps ?tab= and ?q=. */
export default function PenaltiesAlias() {
  return <ClientRedirect to="/operator/cases" />;
}

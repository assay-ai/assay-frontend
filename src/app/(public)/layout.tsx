import * as React from "react";

import { PublicShell } from "@/components/layout/public-shell";

/**
 * The public shell around every public page (`PublicShell`: the public top
 * bar, the page, the public footer).
 *
 * | Screen                         | Route                               |
 * |--------------------------------|-------------------------------------|
 * | How it works                   | `/how-it-works`                     |
 * | Tools (tools, proof feed)      | `/catalogue`                        |
 * | Tool / provider page           | `/catalogue/view`, `/catalogue/provider` |
 * | Live demo (when configured)    | `/demo`                             |
 * | For providers (+ calculator)   | `/why-list-here`                    |
 * | Reserves                       | `/reserves`                         |
 * | Protocol analytics             | `/analytics`                        |
 * | Public receipt of one call     | `/r/view`                           |
 *
 * None of these needs a session, and a 401 never sends them to sign-in
 * (`isPublicPath` in `providers/buyer-session.ts` lists them).
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

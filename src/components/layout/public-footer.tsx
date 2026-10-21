import * as React from "react";

import { DOCS_URL } from "./nav-config";

/**
 * The public pages' footer: the same few destinations at the bottom of every
 * page, and the only inbound link `/reserves` has. Existing pages only; no
 * terms, privacy or support link until those pages exist ("Docs" appears only
 * when `NEXT_PUBLIC_DOCS_URL` is set, as in the top bar). "Proof of reserves"
 * appears only where reserves are published (`GET /public/features`): a trust
 * link that opens "not published" hurts more than no link.
 */
export interface PublicFooterLink {
  id: string;
  label: string;
  href: string;
  external?: boolean;
}

export function publicFooterLinks({ signedIn, reserves }: { signedIn: boolean; reserves: boolean }): PublicFooterLink[] {
  return [
    { id: "how-it-works", label: "How it works", href: "/how-it-works" },
    { id: "tools", label: "Tools", href: "/catalogue" },
    { id: "providers", label: "Why list here", href: "/why-list-here" },
    ...(reserves ? [{ id: "reserves", label: "Proof of reserves", href: "/reserves" }] : []),
    ...(DOCS_URL ? [{ id: "docs", label: "Docs", href: DOCS_URL, external: true }] : []),
    signedIn ? { id: "app", label: "Open app", href: "/" } : { id: "sign-in", label: "Sign in", href: "/login" },
  ];
}

export function PublicFooter({
  linkAs: LinkComponent = "a",
  signedIn = false,
  reserves = false,
}: {
  linkAs?: React.ElementType;
  signedIn?: boolean;
  /** Reserves are published on this deployment. */
  reserves?: boolean;
}) {
  return (
    <footer className="w-full border-t border-01 bg-01">
      <div className="flex w-full flex-col gap-3 px-4 py-6 tablet:flex-row tablet:items-center tablet:justify-between tablet:px-7">
        <span className="text-label-13 text-02">Assay</span>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5">
            {publicFooterLinks({ signedIn, reserves }).map((link) => (
              <li key={link.id}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-body-13 text-03 hover:text-01">
                    {link.label}
                  </a>
                ) : (
                  <LinkComponent href={link.href} className="inline-flex min-h-10 items-center text-body-13 text-03 hover:text-01">
                    {link.label}
                  </LinkComponent>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

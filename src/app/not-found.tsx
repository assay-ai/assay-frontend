import Link from "next/link";

import { DocumentTitle } from "@/components/layout/document-title";
import { PublicShell } from "@/components/layout/public-shell";
import { Button } from "@/components/ui/button";

/**
 * The 404 page, for any address the app does not have. It sits in the public
 * shell (top bar and footer), so a mistyped link still looks like the product,
 * and it offers the three public starting points instead of a bare "home"
 * (which, signed out, is How it works anyway).
 */
const NOT_FOUND_LINKS = [
  { href: "/catalogue", label: "Tools" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/why-list-here", label: "For providers" },
] as const;

export default function NotFound() {
  return (
    <PublicShell>
      <DocumentTitle title="Page not found — Assay" />
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12 tablet:px-7">
        <div className="flex flex-col items-center gap-3">
          <p className="font-mono text-mono-13 text-03">404</p>
          <h1 className="text-center text-heading-lg text-01 tablet:text-display-md">Page not found</h1>
          <p className="max-w-md text-center text-body-md text-02">
            There is no page at this address. It may have moved, or the link may be mistyped.
          </p>
        </div>
        <nav aria-label="Where to go instead" className="flex flex-wrap justify-center gap-2.5">
          {NOT_FOUND_LINKS.map((link, index) => (
            <Button key={link.href} asChild variant={index === 0 ? undefined : "secondary"}>
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>
      </div>
    </PublicShell>
  );
}

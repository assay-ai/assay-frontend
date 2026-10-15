import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/utils";

/**
 * A public page this deployment does not run (/demo without a demo binding,
 * /reserves without published reserves). Not a dead end: one line on what the
 * page would show, then the places that show the same thing with real data,
 * the first one as the obvious next step.
 */
export interface UnavailableDestination {
  href: string;
  title: string;
  description: string;
}

export function UnavailablePage({
  eyebrow,
  title,
  wouldShow,
  destinations,
}: {
  eyebrow: string;
  title: string;
  wouldShow: string;
  destinations: UnavailableDestination[];
}) {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-5 py-6 tablet:py-10">
      <div className="flex flex-col gap-2">
        <p className="text-label-xs uppercase tracking-[0.4px] text-03">{eyebrow}</p>
        <h1 className="text-heading-lg text-01">{title}</h1>
        <p className="text-body-md text-02">{wouldShow}</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {destinations.map((destination, index) => (
          <li key={destination.href}>
            <Link
              href={destination.href}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:p-5",
                index === 0 ? "border-primary-20 bg-primary-10 hover:bg-primary-20" : "border-01 bg-01 hover:bg-02",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-label-md text-01">{destination.title}</span>
                <span className="text-body-13 text-02">{destination.description}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-02 group-hover:text-01" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

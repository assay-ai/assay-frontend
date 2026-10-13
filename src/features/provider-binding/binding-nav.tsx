"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/utils";

import { bindingScreens } from "./screens";

/**
 * Links to every screen of one binding. Without it the pricing, free-tier,
 * declared-SLA, live-SLA and verdict screens were reachable only by typing
 * their URL (UX note R3-journey 13).
 */
export function BindingNav({ bindingId }: { bindingId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Binding screens" className="flex w-full flex-wrap gap-x-4 gap-y-1.5">
      {bindingScreens(bindingId).map((screen) => (
        <Link
          key={screen.href}
          href={screen.href}
          aria-current={pathname === screen.href ? "page" : undefined}
          className={cn(
            "text-label-13 hover:underline",
            pathname === screen.href ? "text-01" : "text-primary-600"
          )}
        >
          {screen.label}
        </Link>
      ))}
    </nav>
  );
}

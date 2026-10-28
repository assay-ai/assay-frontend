"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ExternalLink, Menu, Plus, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { DOCS_URL } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

/**
 * Public Top Bar: 60px tall, `$bg-01` fill, 1px `$border-01` bottom hairline.
 * The marketing shell (How it works, Tools, Demo, provider pages), distinct
 * from the buyer console's `Top Bar` (56px). "Tools" is the public
 * `/catalogue`; the app's own "Explore" is a different page.
 *
 *   Assay [Testnet]  How it works · Tools · Demo · For providers · Docs
 *                                          Sign in  (+ List a tool)  [Start free]
 *   (signed in: [Open app] in place of "Sign in" and "Start free")
 *
 * The filled button is the buyer's: "Start free" signed out, "Open app"
 * signed in. "List a tool" is the outlined secondary, so a buyer and a
 * provider each see their path, and neither is hidden behind the other.
 * Below `tablet`, the filled button stays in the bar; the links, "List a tool"
 * and the theme switch move into the menu. "Sign in" stays in the bar down to
 * 420px; narrower than that (a 360-390px phone) the bar cannot hold the chip,
 * "Sign in", "Start free" and the menu button without scrolling sideways, so
 * "Sign in" moves to the top of the menu. Signing in is still one tap away:
 * "Start free" opens the same sign-in page.
 *
 * "For providers" is one page (the offer with the earnings calculator
 * embedded); "Demo" shows only where it is configured. "Docs" appears
 * only when `NEXT_PUBLIC_DOCS_URL` is set — a link to nowhere is worse than
 * no link.
 */

export interface PublicTopBarLink {
  id: string;
  label: string;
  href: string;
  /** Opens in a new tab with an external-link mark. */
  external?: boolean;
  /** One line under the label, in the group menu. */
  description?: string;
}

export interface PublicTopBarNavItem extends Partial<PublicTopBarLink> {
  id: string;
  label: string;
  /** A group: rendered as a menu on desktop and a labelled list on mobile. */
  items?: PublicTopBarLink[];
}

const DEFAULT_NAV_ITEMS: PublicTopBarNavItem[] = [
  { id: "how-it-works", label: "How it works", href: "/how-it-works" },
  { id: "tools", label: "Tools", href: "/catalogue" },
  { id: "demo", label: "Demo", href: "/demo" },
  { id: "providers", label: "For providers", href: "/why-list-here" },
  { id: "analytics", label: "Analytics", href: "/analytics" },
  ...(DOCS_URL ? [{ id: "docs", label: "Docs", href: DOCS_URL, external: true }] : []),
];

/**
 * The bar's items for this deployment: "Demo" only where the live demo is
 * configured (`GET /public/features`), so the bar never links to a page that
 * can only say "not available".
 */
export function publicNavItems({ demo }: { demo: boolean }): PublicTopBarNavItem[] {
  return demo ? DEFAULT_NAV_ITEMS : DEFAULT_NAV_ITEMS.filter((item) => item.id !== "demo");
}

/** Every link in the bar, groups flattened. */
export function flattenPublicNav(items: readonly PublicTopBarNavItem[]): PublicTopBarLink[] {
  return items.flatMap((item) =>
    item.items ? item.items : item.href ? [{ id: item.id, label: item.label, href: item.href, external: item.external }] : [],
  );
}

export interface PublicTopBarProps extends React.HTMLAttributes<HTMLElement> {
  navItems?: PublicTopBarNavItem[];
  linkAs?: React.ElementType;
  signInHref?: string;
  onSignInClick?: () => void;
  listToolHref?: string;
  onListToolClick?: () => void;
  /** A signed-in visitor sees "Open app" (to `appHref`) where "Sign in" would be. */
  signedIn?: boolean;
  appHref?: string;
  /** Where "Start free" goes for a signed-out visitor. */
  startFreeHref?: string;
  /** Next to the logo, e.g. the testnet chip. */
  badge?: React.ReactNode;
}

const FILLED_CLASS =
  "flex min-h-10 shrink-0 items-center gap-[7px] whitespace-nowrap rounded-md bg-primary-400 px-3 py-[9px] text-label-sm font-sans text-on-primary shadow-hair hover:bg-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:px-[14px]";

const LINK_CLASS =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-body-13 font-sans text-02 transition-colors hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

function NavLink({
  link,
  LinkComponent,
  className,
  onClick,
}: {
  link: PublicTopBarLink;
  LinkComponent: React.ElementType;
  className?: string;
  onClick?: () => void;
}) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
        {link.label}
        <ExternalLink aria-hidden="true" className="size-3 text-03" />
      </a>
    );
  }
  return (
    <LinkComponent href={link.href} className={className} onClick={onClick}>
      {link.label}
    </LinkComponent>
  );
}

const PublicTopBar = React.forwardRef<HTMLElement, PublicTopBarProps>(
  (
    {
      className,
      navItems = DEFAULT_NAV_ITEMS,
      linkAs: LinkComponent = "a",
      signInHref = "/login",
      onSignInClick,
      listToolHref = "/provider/setup",
      onListToolClick,
      signedIn = false,
      appHref = "/",
      startFreeHref = "/login",
      badge,
      ...props
    },
    ref
  ) => {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const menuId = React.useId();
    const close = () => setMenuOpen(false);

    React.useEffect(() => {
      if (!menuOpen) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setMenuOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [menuOpen]);

    return (
      <header
        ref={ref}
        className={cn("relative w-full border-b border-01 bg-01", className)}
        {...props}
      >
        <div className="flex h-[60px] w-full min-w-0 items-center gap-x-3 px-4 min-[420px]:gap-x-[18px] tablet:px-7">
          <LinkComponent href="/how-it-works" className="flex min-h-10 shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
            <span className="text-[17px] font-medium leading-none tracking-[-0.025em] text-01">Assay</span>
          </LinkComponent>
          {badge}

          <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center gap-1 tablet:flex">
            {navItems.map((item) =>
              item.items ? (
                <DropdownMenuPrimitive.Root key={item.id}>
                  <DropdownMenuPrimitive.Trigger className={cn(LINK_CLASS, "data-[state=open]:text-01")}>
                    {item.label}
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </DropdownMenuPrimitive.Trigger>
                  <DropdownMenuPrimitive.Portal>
                    <DropdownMenuPrimitive.Content
                      align="start"
                      sideOffset={8}
                      className="z-50 w-[260px] rounded-lg border border-01 bg-01 p-1 shadow-soft data-[state=open]:animate-in data-[state=open]:fade-in-0"
                    >
                      {item.items.map((link) => (
                        <DropdownMenuPrimitive.Item key={link.id} asChild>
                          <LinkComponent
                            href={link.href}
                            className="flex w-full cursor-pointer select-none flex-col gap-0.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-02"
                          >
                            <span className="text-label-13 text-01">{link.label}</span>
                            {link.description ? <span className="text-body-xs text-03">{link.description}</span> : null}
                          </LinkComponent>
                        </DropdownMenuPrimitive.Item>
                      ))}
                    </DropdownMenuPrimitive.Content>
                  </DropdownMenuPrimitive.Portal>
                </DropdownMenuPrimitive.Root>
              ) : item.href ? (
                <NavLink
                  key={item.id}
                  link={{ id: item.id, label: item.label, href: item.href, external: item.external }}
                  LinkComponent={LinkComponent}
                  className={LINK_CLASS}
                />
              ) : null
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle className="hidden tablet:inline-flex" />
            {signedIn ? null : (
              <a
                href={signInHref}
                onClick={onSignInClick}
                data-testid="public-bar-sign-in"
                className="hidden min-h-10 items-center whitespace-nowrap rounded-md px-2 py-[9px] text-label-sm font-sans text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-[420px]:inline-flex tablet:px-[14px]"
              >
                Sign in
              </a>
            )}
            <a
              href={listToolHref}
              onClick={onListToolClick}
              className="hidden items-center gap-[7px] whitespace-nowrap rounded-md border border-02 px-[14px] py-[8px] text-label-sm font-sans text-01 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:flex"
            >
              <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
              List a tool
            </a>
            <a href={signedIn ? appHref : startFreeHref} className={FILLED_CLASS}>
              {signedIn ? "Open app" : "Start free"}
            </a>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-02 text-02 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:hidden"
            >
              {menuOpen ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            id={menuId}
            aria-label="Menu"
            className="absolute inset-x-0 top-full z-40 flex flex-col gap-1 border-b border-01 bg-01 px-4 pb-4 pt-2 shadow-lifted tablet:hidden"
          >
            {signedIn ? null : (
              <a
                href={signInHref}
                onClick={() => {
                  onSignInClick?.();
                  close();
                }}
                data-testid="public-menu-sign-in"
                className="flex items-center gap-1 rounded-md px-2 py-2.5 text-body-sm text-01 hover:bg-02 min-[420px]:hidden"
              >
                Sign in
              </a>
            )}
            {navItems.map((item) =>
              item.items ? (
                <div key={item.id} className="flex flex-col gap-0.5 pt-2">
                  <span className="px-2 pb-1 text-label-xs uppercase tracking-[0.4px] text-03">{item.label}</span>
                  {item.items.map((link) => (
                    <NavLink
                      key={link.id}
                      link={link}
                      LinkComponent={LinkComponent}
                      onClick={close}
                      className="flex items-center gap-1 rounded-md px-2 py-2.5 text-body-sm text-01 hover:bg-02"
                    />
                  ))}
                </div>
              ) : item.href ? (
                <NavLink
                  key={item.id}
                  link={{ id: item.id, label: item.label, href: item.href, external: item.external }}
                  LinkComponent={LinkComponent}
                  onClick={close}
                  className="flex items-center gap-1 rounded-md px-2 py-2.5 text-body-sm text-01 hover:bg-02"
                />
              ) : null
            )}
            <div className="my-2 h-px bg-03" role="separator" />
            <a
              href={listToolHref}
              onClick={() => {
                onListToolClick?.();
                close();
              }}
              className="flex items-center justify-center gap-[7px] rounded-md border border-02 px-3 py-2.5 text-label-sm text-01 hover:bg-02"
            >
              <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
              List a tool
            </a>
            <div className="flex items-center justify-between px-2 pt-2">
              <span className="text-body-sm text-02">Theme</span>
              <ThemeToggle />
            </div>
          </nav>
        ) : null}
      </header>
    );
  }
);
PublicTopBar.displayName = "PublicTopBar";

export { PublicTopBar, DEFAULT_NAV_ITEMS as DEFAULT_PUBLIC_NAV_ITEMS };

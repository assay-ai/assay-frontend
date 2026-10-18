"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useSignedIn } from "@/components/explorer/start-free";
import { Button } from "@/components/ui/button";
import { demoEnabled } from "@/libs/demo/demo-api";
import { loginHref } from "@/libs/login-redirect";
import { cn } from "@/utils";

import { ConnectSheet } from "./connect-sheet";

/**
 * The panel at the top of every page an MCP URL opens in a browser (design
 * spec §7.4, "Browser view"): "This is an MCP server URL. Add it to your
 * client." Connect opens the Connect sheet prefilled with that URL. Signed
 * out, it is "Start free", which signs in and comes back here with the sheet
 * open (`open=connect`), so the next click is Copy.
 */

/** `path` with `open=connect` added to its query (before any fragment). */
export function withOpenConnect(path: string): string {
  const [beforeHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = (beforeHash ?? "/").split("?");
  const params = new URLSearchParams(query);
  params.set("open", "connect");
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
}
export function ConnectPanel({
  url,
  title = "This is an MCP server URL. Add it to your client.",
  detail,
  agentId,
  publicPage = false,
  compact = false,
  className,
  nextPath,
  connectLabel = "Connect",
}: {
  /** The MCP URL the page stands for; null while it is not known yet. */
  url: string | null;
  title?: string;
  detail?: React.ReactNode;
  agentId?: string | null;
  /** On a public page a signed-out visitor gets "Start free"; signed-in pages always open the sheet. */
  publicPage?: boolean;
  /** On a phone: the title and the button only, so the page's own content starts higher. */
  compact?: boolean;
  className?: string;
  /** Where "Start free" comes back to, when it must not be this page's own URL (a link-only token). */
  nextPath?: string;
  /** Replaces the default "Connect" label. */
  connectLabel?: string;
}) {
  const privySignedIn = useSignedIn();
  const signedIn = !publicPage || privySignedIn || demoEnabled();
  const [open, setOpen] = React.useState(false);
  const [here, setHere] = React.useState("/");
  React.useEffect(() => setHere(`${window.location.pathname}${window.location.search}${window.location.hash}`), []);
  // Back from "Start free": open the sheet at once.
  React.useEffect(() => {
    if (signedIn && url && new URLSearchParams(window.location.search).get("open") === "connect") setOpen(true);
  }, [signedIn, url]);

  return (
    <section
      aria-label="Connect"
      data-testid="connect-panel"
      className={cn(
        "flex w-full min-w-0 gap-3 rounded-xl border border-primary-20 bg-primary-10 tablet:flex-row tablet:items-center tablet:p-5",
        compact ? "flex-row items-center p-3" : "flex-col p-4",
        className,
      )}
    >
      <Plug aria-hidden="true" className="hidden size-5 shrink-0 text-primary-600 tablet:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-sm text-01">{title}</p>
        {url ? <p className={cn("break-all font-mono text-mono-12 text-02", compact && "hidden tablet:block")}>{url}</p> : null}
        {detail ? <p className={cn("text-body-13 text-02", compact && "hidden tablet:block")}>{detail}</p> : null}
      </div>
      {signedIn ? (
        <Button type="button" className="self-start tablet:self-center" onClick={() => setOpen(true)} disabled={!url}>
          {connectLabel}
        </Button>
      ) : (
        <Button asChild className="self-start tablet:self-center">
          <Link href={loginHref({ next: withOpenConnect(nextPath ?? here) })}>Start free</Link>
        </Button>
      )}
      {signedIn ? <ConnectSheet open={open} onOpenChange={setOpen} initialUrl={url} agentId={agentId ?? null} /> : null}
    </section>
  );
}

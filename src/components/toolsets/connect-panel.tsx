"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useSignedIn } from "@/components/explorer/start-free";
import { Button } from "@/components/ui/button";
import { loginHref } from "@/libs/login-redirect";
import { cn } from "@/utils";

import { ConnectSheet } from "./connect-sheet";

/**
 * The panel at the top of every page an MCP URL opens in a browser (design
 * spec §7.4, "Browser view"): "This is an MCP server URL. Add it to your
 * client." Connect opens the Connect sheet prefilled with that URL. Signed
 * out, it is "Start free", which signs in and comes back here.
 */
export function ConnectPanel({
  url,
  title = "This is an MCP server URL. Add it to your client.",
  detail,
  agentId,
  className,
}: {
  /** The MCP URL the page stands for; null while it is not known yet. */
  url: string | null;
  title?: string;
  detail?: React.ReactNode;
  agentId?: string | null;
  className?: string;
}) {
  const signedIn = useSignedIn();
  const [open, setOpen] = React.useState(false);
  const [here, setHere] = React.useState("/");
  React.useEffect(() => setHere(`${window.location.pathname}${window.location.search}${window.location.hash}`), []);

  return (
    <section
      aria-label="Connect"
      data-testid="connect-panel"
      className={cn("flex w-full min-w-0 flex-col gap-3 rounded-xl border border-primary-20 bg-primary-10 p-4 tablet:flex-row tablet:items-center tablet:p-5", className)}
    >
      <Plug aria-hidden="true" className="hidden size-5 shrink-0 text-primary-600 tablet:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-sm text-01">{title}</p>
        {url ? <p className="break-all font-mono text-mono-12 text-02">{url}</p> : null}
        {detail ? <p className="text-body-13 text-02">{detail}</p> : null}
      </div>
      {signedIn ? (
        <Button type="button" className="self-start tablet:self-center" onClick={() => setOpen(true)} disabled={!url}>
          Connect
        </Button>
      ) : (
        <Button asChild className="self-start tablet:self-center">
          <Link href={loginHref({ next: here })}>Start free</Link>
        </Button>
      )}
      {signedIn ? <ConnectSheet open={open} onOpenChange={setOpen} initialUrl={url} agentId={agentId ?? null} /> : null}
    </section>
  );
}

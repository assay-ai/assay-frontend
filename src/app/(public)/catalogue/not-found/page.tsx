import Link from "next/link";

import { ConnectPanel } from "@/components/toolsets/connect-panel";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";

/**
 * `/catalogue/not-found` — where the MCP host sends a browser that opened a
 * path it does not serve (design spec §7.4, "unknown path"). It says so, and
 * offers the one URL that always works: Everything.
 */
export default function McpNotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      <section className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-5 tablet:p-6" data-testid="mcp-not-found">
        <h1 className="text-heading-md text-01">No MCP server at this address</h1>
        <p className="text-body-13 text-02">
          The link may be mistyped, or the tool set behind it was deleted or is no longer shared. Check it with whoever sent it.
        </p>
        <Link href="/catalogue" className="self-start text-label-13 text-primary-600 hover:underline">
          See all tools
        </Link>
      </section>
      <ConnectPanel url={mcpEndpointUrl()} title="Or connect Everything: every tool on Assay, through one server." />
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { authorizeErrorText } from "@/features/oauth/authorize-error";
import { useFullLoadLinks } from "@/features/oauth/strict-pages";

/**
 * `{WEB}/connect/authorize-error?reason=…`: where the MCP host sends the
 * browser when an app's sign-in cannot even start (spec §6.3.4, step 1). The
 * app itself is never redirected to in these cases, because Assay could not
 * confirm where it lives. No analytics on this route.
 */

function AuthorizeErrorBody() {
  const reason = useSearchParams().get("reason");
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-3 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
      <h1 className="text-heading-md text-01">This app could not connect</h1>
      <p role="status" className="text-body-sm text-02">
        {authorizeErrorText(reason)}
      </p>
      <p className="text-body-13 text-03">You can close this page.</p>
      {/* A plain link: leaving a strict page is a full page load (`strict-pages.ts`). */}
      <a href="/connect" className="self-start text-label-13 font-semibold text-primary-600 hover:underline">
        Connect your agent another way
      </a>
    </section>
  );
}

export default function AuthorizeErrorPage() {
  useFullLoadLinks();
  return (
    <div className="flex w-full flex-1 justify-center px-4 py-8 tablet:py-12">
      <Suspense fallback={null}>
        <AuthorizeErrorBody />
      </Suspense>
    </div>
  );
}

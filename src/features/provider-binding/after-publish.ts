import type { QueryClient } from "@tanstack/react-query";

import type {
  CursorPage,
  PublishedToolBinding,
  ToolBindingDetail,
  ToolBindingSummary,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { revalidateProviderStake } from "@/services/provider-stake.service";

/**
 * What a successful publish has to do to the cache, in one place.
 *
 * ## Why seeding and not invalidating
 *
 * Provider GETs are served `private, max-age=10, stale-while-revalidate=3600`,
 * so invalidating a key right after the write refetches the PRE-write body out
 * of the browser's HTTP cache. That is how BUG-J-PROV-02 looked: the binding
 * was ACTIVE on the server while the publish screen, the rail and Home's
 * headroom all still described the draft. So:
 *
 * - the binding detail is seeded from the publish response, which IS the
 *   binding (`PublishedToolBinding extends ToolBindingDetail`);
 * - the rail's list gets that one row patched from the same response;
 * - the stake cannot be derived locally — publishing adds the binding to the
 *   itemised requirement and moves `headroom` — so it is re-read with
 *   `Cache-Control: no-cache`;
 * - the publish check is only marked stale; the screen leaves it anyway.
 */
export async function applyPublished(
  queryClient: QueryClient,
  published: PublishedToolBinding,
): Promise<void> {
  rememberPublished(published);
  queryClient.setQueryData<ToolBindingDetail>(["provider", "tool-binding", published.id], published);
  queryClient.setQueryData<CursorPage<ToolBindingSummary>>(
    ["provider", "tool-bindings", "sidebar"],
    (previous) =>
      previous
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === published.id
                ? { ...item, status: published.status, version: published.version }
                : item,
            ),
          }
        : previous,
  );
  void queryClient.invalidateQueries({
    queryKey: ["provider", "tool-binding", published.id, "publish-check"],
    refetchType: "none",
  });
  await queryClient
    .fetchQuery({ queryKey: ["provider", "stake"], queryFn: revalidateProviderStake, staleTime: 0 })
    .catch(() => undefined);
}

/**
 * `PROVIDER_BINDING_ALREADY_PUBLISHED`: the revision on screen is the one that
 * is live — a second press, or a stale check. Not a failure to report as one.
 * Branch on `code`, never on the text.
 */
export function isAlreadyLive(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PROVIDER_BINDING_ALREADY_PUBLISHED";
}

/** The binding is serving and its current revision is the live one — nothing to publish. */
export function isPublishedState(binding: ToolBindingDetail | undefined): boolean {
  return binding?.status === "ACTIVE" && binding.hasUnpublishedChanges === false;
}

// ── "Just published" ────────────────────────────────────────────────────────

/**
 * The publish answer, kept for a few minutes in memory so a re-read that is
 * OLDER than it cannot undo it on screen.
 *
 * Seeding the cache (above) is not enough: the tool page re-reads the listing
 * on mount and every minute, and for up to `max-age` the browser answers that
 * read with the pre-publish body — so the page said "Draft · Continue setup"
 * right after a successful publish. The publish response is the server's own
 * word that the listing is live, so it wins over any read that does not yet
 * show that revision as published. Once a read catches up, the read wins and
 * the record is dropped. Nothing is persisted: a reload starts from the server.
 */
export const JUST_PUBLISHED_MS = 5 * 60_000;

const justPublished = new Map<string, { binding: ToolBindingDetail; at: number }>();

export function rememberPublished(binding: ToolBindingDetail, now: number = Date.now()): void {
  justPublished.set(binding.id, { binding, at: now });
}

/** Pure: the listing to show, given a read and the remembered publish answer. */
export function withJustPublished(
  fetched: ToolBindingDetail,
  record: { binding: ToolBindingDetail; at: number } | undefined,
  now: number,
): ToolBindingDetail {
  if (!record || now - record.at > JUST_PUBLISHED_MS) return fetched;
  const live = record.binding.publishedVersion ?? 0;
  const caughtUp = fetched.publishedVersion !== null && fetched.publishedVersion >= live;
  const newerEdit = fetched.version > record.binding.version;
  if (caughtUp || newerEdit) return fetched;
  return { ...fetched, ...record.binding };
}

/** `withJustPublished` against the in-memory record, dropping it once it is no longer needed. */
export function overlayJustPublished(fetched: ToolBindingDetail): ToolBindingDetail {
  const record = justPublished.get(fetched.id);
  if (!record) return fetched;
  const shown = withJustPublished(fetched, record, Date.now());
  if (shown === fetched) justPublished.delete(fetched.id);
  return shown;
}

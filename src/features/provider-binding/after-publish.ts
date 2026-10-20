import type { QueryClient } from "@tanstack/react-query";

import type {
  CursorPage,
  PublishedToolBinding,
  ToolBindingDetail,
  ToolBindingSummary,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { providerQueries } from "@/features/provider-home/queries";

/**
 * What a successful publish has to do to the cache, in one place.
 *
 * ## Why seeding and not invalidating
 *
 * Provider GETs were served `private, max-age=10, stale-while-revalidate=3600`
 * until BUG-SYS-01, so invalidating a key right after the write refetches the PRE-write body out
 * of the browser's HTTP cache. That is how BUG-J-PROV-02 looked: the binding
 * was ACTIVE on the server while the publish screen, the rail and Home's
 * headroom all still described the draft. Seeding still saves the refetches.
So:
 *
 * - the binding detail is seeded from the publish response, which IS the
 *   binding (`PublishedToolBinding extends ToolBindingDetail`);
 * - the rail's list gets that one row patched from the same response;
 * - the stake cannot be derived locally — publishing adds the binding to the
 *   itemised requirement and moves `headroom` — so it is re-read (the route
 *   is now served `private, no-cache`, so that read reaches the API);
 * - the publish check is only marked stale; the screen leaves it anyway.
 */
export async function applyPublished(
  queryClient: QueryClient,
  answer: PublishedToolBinding,
  /** The listing as the wizard last saved it (demo builds only use it, see `demoPublished`). */
  before?: ToolBindingDetail | null,
): Promise<void> {
  const published = demoEnabled() && before ? demoPublished(answer, before) : answer;
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
    .fetchQuery({ ...providerQueries.stake(), staleTime: 0 })
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
 * The demo fixture layer is stateless: its publish answer is the stock draft
 * flipped to live, so a price set on Go live would read back as "Free". In a
 * demo build the terms the wizard last saved win and the publish answer only
 * contributes what publishing changes (status and revision). Never used
 * against a real API, whose publish answer IS the published listing.
 */
export function demoPublished(answer: PublishedToolBinding, before: ToolBindingDetail): PublishedToolBinding {
  return {
    ...before,
    status: answer.status,
    publishedVersion: answer.publishedVersion ?? before.version,
    hasUnpublishedChanges: false,
    version: Math.max(answer.version, before.version),
    publishedAt: answer.publishedAt,
  };
}

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
 * the record is dropped. The seed itself (the very object remembered) is not
 * a read: dropping the record on it is what let the next stale read undo the
 * publish. Nothing is persisted: a reload starts from the server. A demo build
 * keeps the record for the session, since its fixtures never catch up.
 */
export const JUST_PUBLISHED_MS = 5 * 60_000;

const justPublished = new Map<string, { binding: ToolBindingDetail; at: number }>();

export function rememberPublished(binding: ToolBindingDetail, now: number = Date.now()): void {
  justPublished.set(binding.id, { binding, at: now });
}

/**
 * A later save of the same listing (Settings) while the record is held: a new
 * revision ends the record (reads show it as it is); a save that did not move
 * the revision (only the stateless demo answers like that) updates the
 * remembered terms so the overlay does not put the old price back.
 */
export function noteSaved(saved: ToolBindingDetail): void {
  const record = justPublished.get(saved.id);
  if (!record) return;
  if (saved.version > record.binding.version || !demoEnabled()) {
    justPublished.delete(saved.id);
    return;
  }
  const { status, publishedVersion, hasUnpublishedChanges, version } = record.binding;
  record.binding = { ...saved, status, publishedVersion, hasUnpublishedChanges, version };
}

/** Pure: the listing to show, given a read and the remembered publish answer. */
export function withJustPublished(
  fetched: ToolBindingDetail,
  record: { binding: ToolBindingDetail; at: number } | undefined,
  now: number,
  ttl: number = JUST_PUBLISHED_MS,
): ToolBindingDetail {
  if (!record || now - record.at > ttl) return fetched;
  if (fetched === record.binding) return fetched;
  const live = record.binding.publishedVersion ?? 0;
  const caughtUp = fetched.publishedVersion !== null && fetched.publishedVersion >= live;
  const newerEdit = fetched.version > record.binding.version;
  if (caughtUp || newerEdit) return fetched;
  return { ...fetched, ...record.binding };
}

/** `withJustPublished` against the in-memory record, dropping it once a real read caught up. */
export function overlayJustPublished(fetched: ToolBindingDetail): ToolBindingDetail {
  const record = justPublished.get(fetched.id);
  if (!record) return fetched;
  const ttl = demoEnabled() ? Number.POSITIVE_INFINITY : JUST_PUBLISHED_MS;
  const shown = withJustPublished(fetched, record, Date.now(), ttl);
  if (shown === fetched && fetched !== record.binding && !demoEnabled()) justPublished.delete(fetched.id);
  return shown;
}

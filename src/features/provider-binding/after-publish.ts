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

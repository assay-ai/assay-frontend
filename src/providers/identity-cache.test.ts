import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { settleCacheForIdentity } from "./identity-cache";

/** A fetch the test resolves by hand, so the identity change lands mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

function mounted(queryClient: QueryClient, queryFn: () => Promise<unknown>) {
  const observer = new QueryObserver(queryClient, { queryKey: ["provider", "publish-check"], queryFn });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
}

describe("settleCacheForIdentity", () => {
  it("documents the defect: clear() mid-fetch leaves a mounted query loading forever", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const first = deferred<string>();
    const { observer, unsubscribe } = mounted(queryClient, () => first.promise);
    expect(observer.getCurrentResult().isLoading).toBe(true);

    queryClient.clear();
    first.resolve("gate");
    await flush();

    expect(observer.getCurrentResult().isLoading).toBe(true);
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });

  it("documents the defect: after clear() the next render of a loaded screen comes up empty", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const options = { queryKey: ["provider", "tool-binding", "b-1"], queryFn: async () => "binding" };
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await flush();
    expect(observer.getCurrentResult().data).toBe("binding");

    queryClient.clear();

    // What `useQuery` computes on the keystroke's re-render: a fresh, empty
    // query, so `disabled={!binding}` disables the focused field.
    expect(observer.getOptimisticResult(queryClient.defaultQueryOptions(options)).data).toBeUndefined();
    unsubscribe();
  });

  it("boot: a fetch in flight still lands on the mounted screen", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    let calls = 0;
    const { observer, unsubscribe } = mounted(queryClient, async () => {
      calls += 1;
      return `gate-${calls}`;
    });

    settleCacheForIdentity(queryClient, "boot");
    await flush();

    const result = observer.getCurrentResult();
    expect(result.isLoading).toBe(false);
    expect(result.data).toMatch(/^gate-/);
    unsubscribe();
  });

  it("boot: data already on screen stays there while it refetches", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const second = deferred<string>();
    let calls = 0;
    const { observer, unsubscribe } = mounted(queryClient, () => {
      calls += 1;
      return calls === 1 ? Promise.resolve("binding") : second.promise;
    });
    await flush();
    expect(observer.getCurrentResult().data).toBe("binding");

    settleCacheForIdentity(queryClient, "boot");
    await flush();

    // No empty frame in between: a field gated on this data stays enabled.
    expect(observer.getCurrentResult().data).toBe("binding");
    expect(observer.getCurrentResult().isFetching).toBe(true);
    second.resolve("binding-again");
    await flush();
    expect(observer.getCurrentResult().data).toBe("binding-again");
    unsubscribe();
  });

  it("switch: another identity's data is dropped and the mounted query refetches", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const refetch = deferred<string>();
    let calls = 0;
    const { observer, unsubscribe } = mounted(queryClient, () => {
      calls += 1;
      return calls === 1 ? Promise.resolve("tenant-a") : refetch.promise;
    });
    queryClient.setQueryData(["provider", "unmounted"], "tenant-a-other");
    await flush();

    settleCacheForIdentity(queryClient, "switch");
    await flush();

    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isLoading).toBe(true);
    expect(queryClient.getQueryData(["provider", "unmounted"])).toBeUndefined();

    refetch.resolve("tenant-b");
    await flush();
    expect(observer.getCurrentResult().isLoading).toBe(false);
    expect(observer.getCurrentResult().data).toBe("tenant-b");
    unsubscribe();
  });
});

/**
 * Reads a service makes outside a component (the display asset off `GET
 * /balances`, the chain list off `GET /chains`) go through the app's React
 * Query cache, under the same key and freshness the screens use, so they join
 * the screen's request instead of sending their own.
 *
 * `createAppQueryClient` plugs the app's client in. Without one (a unit test,
 * a script) the read is sent directly, as before.
 */
export type SharedReader = <T>(queryKey: readonly unknown[], read: () => Promise<T>, staleTime: number) => Promise<T>;

const direct: SharedReader = (_queryKey, read) => read();
let reader: SharedReader = direct;

export function setSharedReader(next: SharedReader | null): void {
  reader = next ?? direct;
}

export function sharedRead<T>(queryKey: readonly unknown[], read: () => Promise<T>, staleTime: number): Promise<T> {
  return reader(queryKey, read, staleTime);
}

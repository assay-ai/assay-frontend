/**
 * One tester run at a time, decided synchronously.
 *
 * `mutation.isPending` is render state: a burst of Enter presses all read the
 * same `false` before React re-renders, and each one posts a run. This flag
 * flips in the same tick the run starts.
 */
export function createRunGuard() {
  let busy = false;
  return {
    /** `true` when the caller may start a run; it must call `leave` when the run settles. */
    enter(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave(): void {
      busy = false;
    },
  };
}

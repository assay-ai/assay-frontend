/**
 * Whole percents of `total` that add up to 100 (largest remainder): rounded
 * one by one, three tools at 17% + 13% + 63% left 7% unexplained.
 */
export function wholePercents(counts: readonly number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((count) => (count / total) * 100);
  const floors = exact.map(Math.floor);
  const target = Math.round(exact.reduce((sum, value) => sum + value, 0));
  let missing = target - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    floors[index] += 1;
    missing -= 1;
  }
  return floors;
}

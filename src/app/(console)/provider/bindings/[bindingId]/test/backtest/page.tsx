import { BacktestView } from "./_components/backtest-view";

/** Corpus backtest. */
export default async function BacktestPage({
  params,
}: {
  params: Promise<{ bindingId: string }>;
}) {
  const { bindingId } = await params;
  return <BacktestView bindingId={bindingId} />;
}

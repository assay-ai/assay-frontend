import { PageState } from "@/components/patterns/page-state";

/** A page on its way: one visible line and placeholder rows, announced once to screen readers. */
export function RouteLoading({ label = "Opening the page" }: { label?: string }) {
  return (
    <div className="flex w-full flex-col gap-3" data-testid="route-loading">
      <p aria-hidden="true" className="text-body-13 text-03">
        {label}…
      </p>
      <PageState kind="loading" rows={5} label={label} />
    </div>
  );
}

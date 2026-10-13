import { classLabel } from "./labels";

/**
 * A call class as a name, with the raw value beside it as a small code — the
 * value in the CSV's `classification` column, which is what a provider matches
 * a row against.
 */
export function ClassName({ name }: { name: string }) {
  const label = classLabel(name);
  return (
    <span className="flex flex-col">
      <span className="font-sans font-semibold">{label}</span>
      {label !== name ? <code className="font-mono text-mono-xs font-normal text-03">{name}</code> : null}
    </span>
  );
}

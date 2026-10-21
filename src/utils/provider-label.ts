/**
 * A listing is never labelled by its address: not a host, not an IP, not a
 * port. Screens name a listing by its tool (`useProviderToolNames` in
 * `features/provider-binding/tool-name.tsx`); the full address appears only
 * in the listing's Settings → Connection.
 */

/**
 * A binding id, shortened for display.
 *
 * The design writes `bnd_7QK`; the wire gives a bare UUID and there is no
 * short-ref form anywhere in the API, so screens show a truncated uuid rather
 * than invent a `bnd_` prefix the platform does not issue. Always pair it with
 * the full id somewhere copyable.
 */
export function shortBindingId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

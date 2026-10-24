import * as React from "react";

type FocusHandler = (event: Event) => void;

/**
 * `onOpenAutoFocus` / `onCloseAutoFocus` handlers for a Radix dialog content
 * that put focus back on the element that opened it.
 *
 * Radix returns focus only to its own `Trigger`. A dialog or sheet opened from
 * state (a button that sets `open`, or a `?action=` link) has no Trigger, so
 * focus fell to <body> on close. The opener is read when the content opens,
 * before focus moves into it. A handler of the caller's own runs first and can
 * still prevent the default.
 */
export function useRestoreFocus(handlers: {
  onOpenAutoFocus?: FocusHandler;
  onCloseAutoFocus?: FocusHandler;
}): {
  onOpenAutoFocus: FocusHandler;
  onCloseAutoFocus: FocusHandler;
} {
  const { onOpenAutoFocus, onCloseAutoFocus } = handlers;
  const opener = React.useRef<Element | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      opener.current =
        typeof document === "undefined" ? null : document.activeElement;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      const el = opener.current;
      opener.current = null;
      if (event.defaultPrevented) return;
      if (el instanceof HTMLElement && el.isConnected && el !== document.body) {
        event.preventDefault();
        el.focus();
      }
    },
  };
}

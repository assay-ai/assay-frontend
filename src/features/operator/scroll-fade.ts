import * as React from "react";

/**
 * Marks a sideways-scrolling row with `data-more-left` / `data-more-right`
 * while there is more to scroll that way; `.scroll-fade-x` (globals.scss)
 * fades that edge. Give the row both: `ref={useScrollFade()}` and
 * `className="scroll-fade-x overflow-x-auto"`.
 */
export function useScrollFade<T extends HTMLElement>(): React.RefCallback<T> {
  const cleanup = React.useRef<(() => void) | null>(null);
  return React.useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) return;
    const update = () => {
      const max = node.scrollWidth - node.clientWidth;
      node.toggleAttribute("data-more-left", node.scrollLeft > 1);
      node.toggleAttribute("data-more-right", max - node.scrollLeft > 1);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(node);
    cleanup.current = () => {
      node.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, []);
}

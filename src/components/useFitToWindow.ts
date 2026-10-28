import { useLayoutEffect, type RefObject } from 'react';

/**
 * On wide screens, caps an element's height to the space between its top and the bottom of
 * the window (minus `gap`), so it never makes the page scroll; give it `overflow-y: auto` (or
 * a scrolling child) to scroll inside instead. Re-measures when the window or any element
 * matched by `watch` (things above it that can change size) is resized. Narrow, stacked
 * layouts are left alone so the page scrolls normally.
 */
export function useFitToWindow(ref: RefObject<HTMLElement | null>, watch: string[], minHeight = 180, gap = 16) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = window.matchMedia('(min-width: 900px)');
    const fit = () => {
      if (!wide.matches) {
        el.style.maxHeight = '';
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Keep clear of the page's bottom padding too (larger on an iPad, above the home bar).
      const app = document.querySelector('.app');
      const bottom = app ? Math.max(gap, parseFloat(getComputedStyle(app).paddingBottom) || 0) : gap;
      el.style.maxHeight = `${Math.max(minHeight, window.innerHeight - top - bottom)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const selector of watch) document.querySelectorAll(selector).forEach((n) => observer.observe(n));
    window.addEventListener('resize', fit);
    wide.addEventListener('change', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      wide.removeEventListener('change', fit);
    };
    // The watch list is fixed per component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, minHeight, gap]);
}

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

interface FadeInOptions {
  duration?: number;
  stagger?: number;
  y?: number;
}

/**
 * Fades + slides in the direct children marked `data-fade-item` of the
 * returned ref's element, staggered. Re-runs whenever `deps` changes
 * (e.g. after a data reload) so re-renders replay the entrance.
 */
export function useFadeInOnMount<T extends HTMLElement>(deps: unknown[] = [], options: FadeInOptions = {}): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const { duration = 0.4, stagger = 0.045, y = 10 } = options;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const items = ref.current.querySelectorAll('[data-fade-item]');
    if (items.length === 0) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration, stagger, ease: 'power2.out' }
      );
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

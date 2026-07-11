import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

interface CountUpOptions {
  duration?: number;
  decimals?: number;
  formatter?: (value: number) => string;
}

/**
 * Animates the returned ref's text content from 0 to `value` on mount and
 * whenever `value` changes (GSAP tweens a proxy object, not the DOM number,
 * so partial renders stay accurate mid-flight).
 */
export function useCountUp<T extends HTMLElement>(value: number, { duration = 0.9, decimals = 0, formatter }: CountUpOptions = {}): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const proxy = { val: 0 };
    const render = () => {
      el.textContent = formatter ? formatter(proxy.val) : proxy.val.toFixed(decimals);
    };
    render();
    const tween = gsap.to(proxy, {
      val: value,
      duration,
      ease: 'power2.out',
      onUpdate: render,
    });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return ref;
}

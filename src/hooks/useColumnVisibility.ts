import { useState, useEffect } from 'react';

/** Persists a set of hidden column keys to localStorage, keyed per table. */
export function useColumnVisibility(storageKey: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...hidden]));
  }, [storageKey, hidden]);

  const toggle = (key: string) => setHidden(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const reset = () => setHidden(new Set());

  return { hidden, toggle, reset };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface InfiniteScrollSentinelProps {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  /** Root element for the IntersectionObserver; defaults to the viewport.
   *  Pass the scrollable container's ref when the list scrolls inside a
   *  fixed-height box (e.g. a Kanban column) rather than the page body. */
  rootRef?: React.RefObject<HTMLElement>;
}

export default function InfiniteScrollSentinel({ onLoadMore, hasMore, loading, rootRef }: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMoreRef.current();
      },
      { root: rootRef?.current ?? null, rootMargin: '150px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, rootRef]);

  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-4 text-slate-400">
      {loading && (
        <div className="flex items-center space-x-1.5 text-[10px] font-mono">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading more...</span>
        </div>
      )}
    </div>
  );
}

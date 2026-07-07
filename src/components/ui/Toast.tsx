/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_STYLES: Record<ToastType, { icon: React.ComponentType<{ className?: string }>; className: string; iconClassName: string }> = {
  success: { icon: CheckCircle2, className: 'bg-emerald-50 border-emerald-200 text-emerald-800', iconClassName: 'text-emerald-600' },
  error: { icon: XCircle, className: 'bg-red-50 border-red-200 text-red-800', iconClassName: 'text-red-600' },
  warning: { icon: AlertTriangle, className: 'bg-amber-50 border-amber-200 text-amber-800', iconClassName: 'text-amber-600' },
  info: { icon: Info, className: 'bg-blue-50 border-blue-200 text-blue-800', iconClassName: 'text-blue-600' },
};

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, type, message }]);
    window.setTimeout(() => dismiss(id), DEFAULT_DURATION_MS);
  }, [dismiss]);

  const value: ToastContextValue = {
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
    warning: (message: string) => push('warning', message),
    info: (message: string) => push('info', message),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {toasts.map(t => {
          const style = TOAST_STYLES[t.type];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200 ${style.className}`}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${style.iconClassName}`} />
              <span className="flex-1 leading-relaxed">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

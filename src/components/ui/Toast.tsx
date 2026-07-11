import React, { createContext, useCallback, useContext } from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const value: ToastContextValue = {
    success: useCallback((message: string) => sonnerToast.success(message, { icon: <CheckCircle2 className="w-4 h-4" /> }), []),
    error: useCallback((message: string) => sonnerToast.error(message, { icon: <XCircle className="w-4 h-4" /> }), []),
    warning: useCallback((message: string) => sonnerToast.warning(message, { icon: <AlertTriangle className="w-4 h-4" /> }), []),
    info: useCallback((message: string) => sonnerToast.info(message, { icon: <Info className="w-4 h-4" /> }), []),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          classNames: {
            toast: 'bg-card! text-card-foreground! border-border! rounded-xl! text-xs! font-medium! shadow-lg!',
          },
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

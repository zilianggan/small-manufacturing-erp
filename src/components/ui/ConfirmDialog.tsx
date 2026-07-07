/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Dialog, { DialogFooter, DialogCancelButton } from './Dialog';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive (red) style. Defaults to true. */
  danger?: boolean;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (result: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolveRef = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ message, resolve, ...options });
    });
  }, []);

  const settle = (result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title ?? 'Confirm'}
        maxWidth="max-w-sm"
        titleIcon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
      >
        <div className="p-5 text-xs text-slate-600 leading-relaxed">{pending?.message}</div>
        <div className="px-5 pb-5">
          <DialogFooter>
            <DialogCancelButton onClick={() => settle(false)}>{pending?.cancelLabel ?? 'Cancel'}</DialogCancelButton>
            <button
              type="button"
              onClick={() => settle(true)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                pending?.danger === false ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </button>
          </DialogFooter>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

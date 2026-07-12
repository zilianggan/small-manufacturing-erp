import { useEffect } from 'react';
import { App } from '@capacitor/app';

// Once @capacitor/app is installed, its native side intercepts every hardware
// back press and hands it to JS — there's no OS default to fall back on, so
// one global listener must always decide: close the open detail, or exit.
let activeHandler: (() => void) | null = null;

App.addListener('backButton', () => {
  if (activeHandler) activeHandler();
  else App.exitApp();
});

export function useAndroidBackButton(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    activeHandler = onBack;
    return () => { if (activeHandler === onBack) activeHandler = null; };
  }, [active, onBack]);
}

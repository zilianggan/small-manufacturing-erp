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

// ponytail: browser back button/gesture — Electron shell has no back gesture, so skip there.
const isBrowser = !navigator.userAgent.includes('Electron');
if (isBrowser) {
  window.addEventListener('popstate', () => {
    if (activeHandler) activeHandler();
  });
}

export function useAndroidBackButton(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    activeHandler = onBack;
    return () => { if (activeHandler === onBack) activeHandler = null; };
  }, [active, onBack]);

  // Push a history entry while the detail is open so browser back has
  // something to pop; if it closes any other way, pop that entry back off.
  useEffect(() => {
    if (!isBrowser) return;
    if (active) {
      window.history.pushState({ detail: true }, '');
    } else if (window.history.state?.detail) {
      window.history.back();
    }
  }, [active]);
}

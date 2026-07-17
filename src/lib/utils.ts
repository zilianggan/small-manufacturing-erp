import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Opens a data: URL in a new tab. Chromium blocks top-level navigation
 * directly to a data: URL (silently no-ops), so this converts it to a blob:
 * URL first, which is allowed to open a new tab/window.
 */
export async function openDataUrlInNewTab(dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}

// Phone numbers are stored E.164 (+60123456789) but wa.me wants digits only.
export const waLink = (phone: string): string => `https://wa.me/${phone.replace(/^\+/, '')}`;

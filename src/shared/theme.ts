import type { Theme } from './types';
import { isTheme, object } from '../storage/schema';
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
export function applyTheme(theme: Theme, animate = false): void {
  if (animate) {
    document.documentElement.classList.add('theme-transition');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(
      () => document.documentElement.classList.remove('theme-transition'),
      180,
    );
  }
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('appearance', theme);
  } catch {
    /* Browser may disable DOM storage; chrome.storage remains authoritative. */
  }
}
export async function initializeTheme(): Promise<void> {
  try {
    const cached = localStorage.getItem('appearance');
    if (isTheme(cached)) document.documentElement.dataset.theme = cached;
  } catch {
    /* System theme is the safe first-paint fallback. */
  }
  document.documentElement.classList.add('ready');
  const data = await chrome.storage.local.get('registry');
  applyTheme(
    object(data.registry) && isTheme(data.registry.theme) ? data.registry.theme : 'system',
  );
  document.documentElement.classList.add('ready');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.registry) {
      const registry: unknown = changes.registry.newValue;
      applyTheme(object(registry) && isTheme(registry.theme) ? registry.theme : 'system', true);
    }
  });
}

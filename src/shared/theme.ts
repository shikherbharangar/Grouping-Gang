import type { Theme } from './types';
import { isTheme, object } from '../storage/schema';
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
export async function initializeTheme(): Promise<void> {
  const data = await chrome.storage.local.get('registry');
  applyTheme(
    object(data.registry) && isTheme(data.registry.theme) ? data.registry.theme : 'system',
  );
  document.documentElement.classList.add('ready');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.registry) {
      const registry: unknown = changes.registry.newValue;
      applyTheme(object(registry) && isTheme(registry.theme) ? registry.theme : 'system');
    }
  });
}

import type { Command, Result, StateView } from './types';
import { AppError } from '../domain/errors';
export async function send(command: Command): Promise<Extract<Result, { ok: true }>> {
  const result: Result = await chrome.runtime.sendMessage(command);
  if (!result || !result.ok)
    throw new AppError(
      result && !result.ok ? result.code : 'CONNECTION',
      result && !result.ok
        ? result.message
        : 'The extension is restarting. Close and reopen this page.',
    );
  return result;
}
export async function readState(capture = false): Promise<StateView> {
  const result = await send({ type: 'state', capture });
  if (!result.state)
    throw new AppError('CONNECTION', 'No browser state was returned. Reopen the extension.');
  return result.state;
}
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

/** Live browser changes can affect collapsed state without changing saved metadata. */
export function onBrowserChange(refresh: () => void): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id === chrome.runtime.id &&
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'invalidated'
    ) {
      respond({ ok: true });
      refresh();
    }
    return false;
  });
}

import type { Notice } from '../shared/types';
import { errorMessage } from '../domain/errors';
const PREFIX = 'grouping-gang:';
const shown = new Set<string>();
let activeId: string | null = null;
export async function publishNotice(notice: Notice | null): Promise<void> {
  if (!notice || shown.has(notice.id) || notice.expiresAt <= Date.now()) return;
  shown.add(notice.id);
  const id = PREFIX + notice.kind + ':' + notice.id;
  try {
    if (activeId && activeId !== id) await chrome.notifications.clear(activeId);
    activeId = id;
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Grouping Gang',
      message: notice.message + ' Click to undo.',
      buttons: [{ title: 'Undo' }],
      silent: true,
    });
    setTimeout(
      () => {
        void chrome.notifications.clear(id).catch(report);
      },
      Math.max(0, notice.expiresAt - Date.now()),
    );
  } catch (error) {
    // OS/browser notification settings can suppress a banner. The same short-lived
    // undo remains in the launcher; notification failure must not turn a move into failure.
    report(error);
  }
}
function report(error: unknown): void {
  console.warn('Grouping Gang notification:', errorMessage(error));
}
export function notificationAction(
  id: string,
): { type: 'undo' | 'undo-assignment'; id: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [kind, token] = id.slice(PREFIX.length).split(':');
  return token && (kind === 'move' || kind === 'assignment')
    ? { type: kind === 'move' ? 'undo' : 'undo-assignment', id: token }
    : null;
}
export async function clearOldNotifications(): Promise<void> {
  const all = await chrome.notifications.getAll();
  await Promise.all(
    Object.keys(all)
      .filter((id) => id.startsWith(PREFIX))
      .map((id) => chrome.notifications.clear(id)),
  );
}

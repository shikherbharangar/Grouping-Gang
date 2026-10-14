import type { BrowserGateway } from '../browser/gateway';
import type { Repository } from '../storage/repository';
import type { BrowserTab, Destination, MoveUndo, Notice } from '../shared/types';
import { AppError } from '../domain/errors';
import { NOTICE_MS, UNDO_MS } from '../storage/session';
export async function clearMoveUndo(repo: Repository, epoch: string, now: number): Promise<void> {
  const s = await repo.loadSession(epoch, now);
  await repo.saveSession({
    ...s,
    lastMove: null,
    notice: s.notice?.kind === 'move' ? null : s.notice,
  });
}
export async function rememberMove(
  repo: Repository,
  browser: BrowserGateway,
  before: BrowserTab,
  destination: Destination,
  epoch: string,
  now: number,
  message: string,
): Promise<Notice> {
  const after = await browser.tab(before.id);
  const id = crypto.randomUUID();
  const undo: MoveUndo = {
    id,
    epoch,
    tabId: before.id,
    fromWindowId: before.windowId,
    fromIndex: before.index,
    fromGroupId: before.groupId,
    toWindowId: after.windowId,
    toGroupId: after.groupId,
    destinationId: destination.id,
    createdAt: now,
    expiresAt: now + UNDO_MS,
  };
  const notice: Notice = { id, kind: 'move', message, expiresAt: now + NOTICE_MS };
  const session = await repo.loadSession(epoch, now);
  await repo.saveSession({ ...session, lastMove: undo, notice });
  return notice;
}
export async function undoMove(
  repo: Repository,
  browser: BrowserGateway,
  id: string,
  epoch: string,
  now: number,
): Promise<void> {
  const session = await repo.loadSession(epoch, now);
  const u = session.lastMove;
  if (!u || u.id !== id)
    throw new AppError(
      'UNDO_EXPIRED',
      'This move can no longer be undone. Undo is available for 30 seconds after the latest move.',
    );
  let tab: BrowserTab;
  try {
    tab = await browser.tab(u.tabId);
  } catch {
    throw new AppError('UNDO_TAB', 'The moved tab has closed. There is nothing to undo.');
  }
  if (
    tab.pinned ||
    tab.incognito ||
    tab.windowId !== u.toWindowId ||
    tab.groupId !== u.toGroupId ||
    tab.url?.startsWith('chrome-extension:')
  )
    throw new AppError(
      'UNDO_CHANGED',
      'The tab changed after this move. Undo would be unsafe; place it manually.',
    );
  if (!(await browser.normalWindow(u.fromWindowId)) || !(await browser.normalWindow(tab.windowId)))
    throw new AppError(
      'UNDO_WINDOW',
      'The original window is no longer available. Place this tab manually.',
    );
  const originalGroup =
    u.fromGroupId === -1
      ? null
      : (await browser.groups()).find(
          (g) => g.id === u.fromGroupId && g.windowId === u.fromWindowId,
        );
  if (u.fromGroupId !== -1 && !originalGroup)
    throw new AppError(
      'UNDO_GROUP',
      'The original group has closed or moved windows. Undo cannot recreate it safely.',
    );
  // Consume before the first mutation. A failed or interrupted reversal is never retried blindly.
  await repo.saveSession({
    ...session,
    lastMove: null,
    notice: session.notice?.id === id ? null : session.notice,
  });
  if (tab.windowId !== u.fromWindowId) await browser.move(tab.id, u.fromWindowId, u.fromIndex);
  if (originalGroup) {
    // Restore approximate position before grouping; moving a grouped tab past a
    // group boundary afterwards can silently ungroup it in Chromium.
    await browser.move(tab.id, u.fromWindowId, u.fromIndex);
    await browser.group([tab.id], originalGroup.id);
    if (originalGroup.collapsed) await browser.updateGroup(originalGroup.id, { collapsed: false });
    // Grouping may place it at the group's edge. Membership wins over exact index.
  } else {
    await browser.ungroup(tab.id);
    await browser.move(tab.id, u.fromWindowId, u.fromIndex);
  }
  const result = await browser.tab(tab.id);
  if (result.windowId !== u.fromWindowId || result.groupId !== u.fromGroupId)
    throw new AppError(
      'UNDO_VERIFY',
      'Undo was only partly applied. Check the tab’s position; it will not be retried automatically.',
    );
  await browser.activate(tab.id, u.fromWindowId);
}

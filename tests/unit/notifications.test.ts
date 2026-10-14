import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishNotice, clearOldNotifications } from '../../src/background/notifications';
describe('native undo notification adapter', () => {
  const create = vi.fn(async () => 'id');
  const clear = vi.fn(async () => true);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    create.mockClear();
    clear.mockClear();
    vi.stubGlobal('chrome', {
      notifications: {
        create,
        clear,
        getAll: async () => ({ 'grouping-gang:move:old': {}, unrelated: {} }),
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('provides an explicit Undo button and clears the banner after five seconds', async () => {
    await publishNotice({
      id: 'one',
      kind: 'move',
      message: 'Moved to Research.',
      expiresAt: 6000,
    });
    expect(create).toHaveBeenCalledWith(
      'grouping-gang:move:one',
      expect.objectContaining({
        buttons: [{ title: 'Undo' }],
        silent: true,
        message: 'Moved to Research. Click to undo.',
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(clear).toHaveBeenCalledWith('grouping-gang:move:one');
  });
  it('does not publish expired or duplicate notices', async () => {
    await publishNotice({ id: 'expired', kind: 'move', message: 'Old', expiresAt: 999 });
    const notice = { id: 'two', kind: 'assignment' as const, message: 'Assigned', expiresAt: 6000 };
    await publishNotice(notice);
    await publishNotice(notice);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('replaces an older banner so only the latest action is offered', async () => {
    await publishNotice({
      id: 'replace-first',
      kind: 'move',
      message: 'First move',
      expiresAt: 6000,
    });
    await publishNotice({
      id: 'replace-second',
      kind: 'move',
      message: 'Second move',
      expiresAt: 6000,
    });
    expect(clear).toHaveBeenCalledWith('grouping-gang:move:replace-first');
    expect(create).toHaveBeenLastCalledWith(
      'grouping-gang:move:replace-second',
      expect.any(Object),
    );
  });
  it('notification denial does not turn a completed move into failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('OS denied notifications'));
    await expect(
      publishNotice({ id: 'denied', kind: 'move', message: 'Moved', expiresAt: 6000 }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('cleans up only its own stale native banners on worker start', async () => {
    await clearOldNotifications();
    expect(clear).toHaveBeenCalledExactlyOnceWith('grouping-gang:move:old');
  });
});

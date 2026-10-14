import type { BrowserGateway } from '../browser/gateway';
import { SLOTS } from '../shared/types';
import { fromGroup, orderGroups, validateProposal } from '../domain/setup';
import { clearMoveUndo, rememberMove, undoMove } from './undo';
import { NOTICE_MS, UNDO_MS } from '../storage/session';
import { assign, transfer } from '../domain/assignment';
import { AppError, errorMessage } from '../domain/errors';
import { reconcile, resolve } from '../domain/identity';
import type { Repository } from '../storage/repository';
import type {
  BrowserTab,
  CapturedSource,
  Notice,
  Command,
  Destination,
  LiveGroup,
  Registry,
  Result,
  StateView,
  TabContext,
} from '../shared/types';

export class Engine {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly repo: Repository,
    private readonly browser: BrowserGateway,
    private readonly now = Date.now,
  ) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  dispatch(command: Command, source?: CapturedSource): Promise<Result> {
    return this.serialize(async () => {
      try {
        return await this.execute(command, source);
      } catch (error) {
        // Reconcile once after a failed operation; never repeat browser mutations.
        try {
          await this.refresh();
        } catch (reconcileError) {
          console.error('Reconciliation failed:', errorMessage(reconcileError));
        }
        return {
          ok: false,
          code: error instanceof AppError ? error.code : 'BROWSER',
          message:
            error instanceof AppError
              ? error.message
              : `The browser could not finish: ${errorMessage(error)}. Check the tab and try again.`,
        };
      }
    });
  }
  async latestNotice(): Promise<Notice | null> {
    const s = await this.repo.loadSession(await this.browser.epoch(), this.now());
    return s.notice;
  }
  reconcileEvent(removedGroupId?: number): Promise<void> {
    return this.serialize(async () => {
      if (removedGroupId !== undefined) {
        const registry = await this.repo.load();
        const epoch = await this.browser.epoch();
        const destinations = registry.destinations.map((d) =>
          d.binding?.epoch === epoch && d.binding.groupId === removedGroupId
            ? { ...d, binding: null }
            : d,
        );
        if (JSON.stringify(destinations) !== JSON.stringify(registry.destinations))
          await this.repo.save({ ...registry, destinations });
      }
      await this.refresh();
    });
  }
  private async refresh(): Promise<{ registry: Registry; groups: LiveGroup[]; epoch: string }> {
    const registry = await this.repo.load();
    const epoch = await this.browser.epoch();
    const groups = await this.browser.groups();
    let next = reconcile(registry, groups, epoch, this.now());
    const session = await this.repo.loadSession(epoch, this.now());
    const added: Destination[] = [];
    if (next.setupCompleted && next.autoAssign && session.knownGroups !== null && !next.pending) {
      const active = await this.browser.activeTab();
      for (const group of orderGroups(groups, active?.windowId ?? null)) {
        if (
          session.knownGroups.includes(group.id) ||
          next.destinations.some(
            (d) => d.binding?.epoch === epoch && d.binding.groupId === group.id,
          )
        )
          continue;
        if (
          next.destinations.some((d) => {
            const view = resolve(d, groups, epoch, next.pending);
            return view.state !== 'live' && view.candidates.includes(group.id);
          })
        )
          continue;
        const slot = SLOTS.find((slot) => !next.destinations.some((d) => d.slot === slot));
        if (slot === undefined) break;
        const d = fromGroup(group, slot, epoch, this.now());
        next = assign(next, d, false);
        added.push(d);
      }
    }
    const knownGroups = groups.map((g) => g.id).sort((a, b) => a - b);
    if (added.length || JSON.stringify(session.knownGroups) !== JSON.stringify(knownGroups)) {
      if (added.length) {
        const id = crypto.randomUUID();
        session.assignmentUndo = { id, destinations: added, expiresAt: this.now() + UNDO_MS };
        session.notice = {
          id,
          kind: 'assignment',
          message:
            added.length === 1
              ? `Assigned ${added[0]!.title || 'Untitled group'} to ${added[0]!.slot}.`
              : `Assigned ${added.length} new groups to free numbers.`,
          expiresAt: this.now() + NOTICE_MS,
        };
      }
      await this.repo.saveSession({ ...session, knownGroups });
    }
    if (JSON.stringify(next) !== JSON.stringify(registry)) await this.repo.save(next);
    return { registry: next, groups, epoch };
  }
  private async view(capture: boolean, source?: CapturedSource): Promise<StateView> {
    // Capture before state I/O. A keyboard launch can hand off its pre-open source.
    const tab = capture
      ? (source ??
        (await this.browser
          .activeTab()
          .then((t) => (t ? { tabId: t.id, windowId: t.windowId, title: t.title } : null))))
      : null;
    const { registry, groups, epoch } = await this.refresh();
    const session = await this.repo.loadSession(epoch, this.now());
    return {
      destinations: registry.destinations.map((d) => resolve(d, groups, epoch, registry.pending)),
      groups: orderGroups(groups, tab?.windowId ?? null),
      setupCompleted: registry.setupCompleted,
      autoAssign: registry.autoAssign,
      undo: session.lastMove,
      assignmentUndo: session.assignmentUndo
        ? { id: session.assignmentUndo.id, expiresAt: session.assignmentUndo.expiresAt }
        : null,
      notice: session.notice,
      theme: registry.theme,
      context: tab ? { tabId: tab.tabId, windowId: tab.windowId } : null,
      tabTitle: tab?.title || '',
      shortcut: await this.browser.shortcut(),
      version: '1.1.1',
    };
  }
  private async intendedTab(context: TabContext): Promise<BrowserTab> {
    let tab: BrowserTab;
    try {
      tab = await this.browser.tab(context.tabId);
    } catch {
      throw new AppError(
        'STALE_TAB',
        'The source tab has closed. Reopen the launcher from a webpage.',
      );
    }
    if (tab.windowId !== context.windowId || !tab.active)
      throw new AppError('STALE_TAB', 'The active tab changed. Close and reopen the switcher.');
    if (tab.pinned)
      throw new AppError(
        'PINNED',
        'Pinned tabs stay pinned. Unpin this tab yourself before moving it.',
      );
    if (tab.incognito || !(await this.browser.normalWindow(tab.windowId)))
      throw new AppError('WINDOW', 'Choose a tab in a regular browser window.');
    if (tab.url?.startsWith('chrome-extension:'))
      throw new AppError(
        'EXTENSION_TAB',
        'Return to the webpage you want to move, then open the switcher.',
      );
    return tab;
  }
  private destination(registry: Registry, slot: number): Destination {
    const d = registry.destinations.find((d) => d.slot === slot);
    if (!d) throw new AppError('EMPTY', 'This number is unassigned. Choose a group in settings.');
    return d;
  }
  private async move(context: TabContext, group: LiveGroup): Promise<BrowserTab | null> {
    const tab = await this.intendedTab(context);
    if (!(await this.browser.normalWindow(group.windowId)))
      throw new AppError('WINDOW', 'The destination window is no longer available.');
    if (tab.groupId === group.id && tab.windowId === group.windowId) {
      if (group.collapsed) await this.browser.updateGroup(group.id, { collapsed: false });
      await this.browser.activate(tab.id, group.windowId);
      return null;
    }
    await clearMoveUndo(this.repo, await this.browser.epoch(), this.now());
    // Chromium cannot keep the current page visible inside a collapsed group.
    // Expand deliberately, and leave the user's title and colour untouched.
    if (tab.windowId !== group.windowId) await this.browser.move(tab.id, group.windowId);
    await this.browser.group([tab.id], group.id);
    if (group.collapsed) await this.browser.updateGroup(group.id, { collapsed: false });
    const moved = await this.browser.tab(tab.id);
    if (moved.groupId !== group.id || moved.windowId !== group.windowId)
      throw new AppError(
        'VERIFY',
        'The browser did not place the tab in the destination. Check its location before retrying.',
      );
    await this.browser.activate(tab.id, group.windowId);
    return tab;
  }
  private async execute(command: Command, source?: CapturedSource): Promise<Result> {
    if (command.type === 'reset') {
      await this.repo.reset();
      return { ok: true, state: await this.view(false) };
    }
    if (command.type === 'state')
      return { ok: true, state: await this.view(command.capture === true, source) };
    if (command.type === 'sessions') return { ok: true, sessions: await this.browser.sessions() };
    const { registry, groups, epoch } = await this.refresh();
    if (command.type === 'undo') {
      await undoMove(this.repo, this.browser, command.id, epoch, this.now());
      return { ok: true, outcome: 'Move undone.', state: await this.view(false) };
    }
    if (command.type === 'undo-assignment' || command.type === 'dismiss-notice') {
      const session = await this.repo.loadSession(epoch, this.now());
      if (command.type === 'undo-assignment') {
        const undo = session.assignmentUndo;
        if (!undo || undo.id !== command.id)
          throw new AppError(
            'UNDO_EXPIRED',
            'This automatic assignment can no longer be undone. Edit its number in settings.',
          );
        if (
          !undo.destinations.every((original) =>
            registry.destinations.some(
              (d) =>
                d.id === original.id &&
                d.slot === original.slot &&
                d.binding?.epoch === original.binding?.epoch &&
                d.binding?.groupId === original.binding?.groupId,
            ),
          )
        )
          throw new AppError(
            'UNDO_CHANGED',
            'These assignments changed. Edit them in settings instead.',
          );
        await this.repo.save({
          ...registry,
          destinations: registry.destinations.filter(
            (d) => !undo.destinations.some((original) => original.id === d.id),
          ),
        });
        session.assignmentUndo = null;
      }
      if (session.notice?.id === command.id) session.notice = null;
      await this.repo.saveSession(session);
      return { ok: true, state: await this.view(false) };
    }
    if (command.type === 'setup') {
      if (registry.setupCompleted || registry.destinations.length)
        throw new AppError(
          'SETUP',
          'Setup is already complete. Change individual numbers in settings.',
        );
      validateProposal(command.assignments, groups);
      const destinations = command.assignments.map((a) =>
        fromGroup(
          groups.find((g) => g.id === a.groupId)!,
          a.slot,
          epoch,
          this.now(),
        ),
      );
      await this.repo.save({
        ...registry,
        destinations,
        setupCompleted: true,
        autoAssign: command.autoAssign,
      });
      return { ok: true, state: await this.view(false) };
    }
    if (command.type === 'auto-assign') {
      await this.repo.save({ ...registry, autoAssign: command.enabled });
      return { ok: true };
    }
    if (command.type === 'theme') {
      await this.repo.save({ ...registry, theme: command.theme });
      return { ok: true };
    }
    if (command.type === 'assign') {
      const group = groups.find((g) => g.id === command.groupId);
      if (!group)
        throw new AppError('GROUP_MISSING', 'That group has closed. Refresh and choose another.');
      const previous = registry.destinations.find((d) => d.slot === command.slot);
      const d: Destination = {
        id: previous?.id || crypto.randomUUID(),
        slot: command.slot,
        title: group.title,
        color: group.color,
        lastSeenAt: this.now(),
        binding: { epoch, groupId: group.id, windowId: group.windowId, tabIds: group.tabIds },
      };
      if (previous && !command.replace)
        throw new AppError('CONFLICT', 'Confirm replacing this assignment first.');
      let next = { ...assign(registry, d, command.replace), setupCompleted: true };
      if (next.pending?.destinationId === d.id) next = { ...next, pending: null };
      await this.repo.save(next);
    } else if (command.type === 'transfer') {
      await this.repo.save(transfer(registry, command.from, command.to));
    } else if (command.type === 'forget') {
      const d = this.destination(registry, command.slot);
      await this.repo.save({
        ...registry,
        destinations: registry.destinations.filter((item) => item.id !== d.id),
        pending: registry.pending?.destinationId === d.id ? null : registry.pending,
      });
    } else if (command.type === 'move') {
      const d = this.destination(registry, command.slot);
      const view = resolve(d, groups, epoch, registry.pending);
      if (!view.group)
        return this.recover(
          { type: 'recover', slot: command.slot, context: command.context },
          registry,
          groups,
          epoch,
        );
      const before = await this.move(command.context, view.group);
      const notice = before
        ? await rememberMove(
            this.repo,
            this.browser,
            before,
            d,
            epoch,
            this.now(),
            `Moved to ${d.title || 'Untitled group'}.`,
          )
        : undefined;
      return { ok: true, ...(notice ? { notice } : {}), state: await this.view(false) };
    } else if (command.type === 'recover') {
      return await this.recover(command, registry, groups, epoch);
    }
    return { ok: true, state: await this.view(false) };
  }
  private async recover(
    command: Extract<Command, { type: 'recover' }>,
    registry: Registry,
    groups: LiveGroup[],
    epoch: string,
  ): Promise<Result> {
    const d = this.destination(registry, command.slot);
    const view = resolve(d, groups, epoch, registry.pending);
    if (view.group) {
      const before = command.context ? await this.move(command.context, view.group) : null;
      const notice = before
        ? await rememberMove(
            this.repo,
            this.browser,
            before,
            d,
            epoch,
            this.now(),
            `Moved to ${d.title || 'Untitled group'}.`,
          )
        : undefined;
      return {
        ok: true,
        outcome: 'The original live group was already available.',
        ...(notice ? { notice } : {}),
        state: await this.view(false),
      };
    }
    if (registry.pending)
      throw new AppError(
        'INTERRUPTED',
        'A recovery was interrupted. Bind its resulting group, or forget that assignment in settings. No automatic retry will create another group.',
      );
    if (view.state === 'ambiguous')
      throw new AppError(
        'AMBIGUOUS',
        'A similar group is already open. Resolve this destination in settings before recreating it.',
      );
    let current = command.context ? await this.intendedTab(command.context) : null;
    const original = current ? { ...current } : null;
    if (
      command.sessionId &&
      !(await this.browser.sessions()).some((s) => s.sessionId === command.sessionId)
    )
      throw new AppError('SESSION_MISSING', 'That closed tab is no longer available.');
    // Persist intent before any recovery side effect. An interrupted request blocks
    // further recreation until explicitly rebound or forgotten, including after restart.
    let next: Registry = {
      ...registry,
      pending: {
        destinationId: d.id,
        epoch,
        tabId: current?.id ?? 0,
        previousGroupId: current?.groupId ?? -1,
        createdGroupId: null,
      },
    };
    if (original) await clearMoveUndo(this.repo, epoch, this.now());
    await this.repo.save(next);
    const restored = command.sessionId ? await this.browser.restoreTab(command.sessionId) : null;
    if (
      restored &&
      (restored.pinned ||
        restored.incognito ||
        !(await this.browser.normalWindow(restored.windowId)))
    ) {
      throw new AppError(
        'SESSION_SCOPE',
        'The restored tab cannot safely be grouped. Inspect it and resolve the interrupted recovery in settings.',
      );
    }
    current ??= restored ?? (await this.browser.createTab());
    if (current.pinned || current.incognito || !(await this.browser.normalWindow(current.windowId)))
      throw new AppError(
        'WINDOW',
        'The recovered tab cannot safely be grouped. Bind or clear this recovery in settings.',
      );
    next = {
      ...next,
      pending: {
        destinationId: d.id,
        epoch,
        tabId: current.id,
        previousGroupId: current.groupId,
        createdGroupId: null,
      },
    };
    await this.repo.save(next);
    if (restored && restored.id !== current.id && restored.windowId !== current.windowId)
      await this.browser.move(restored.id, current.windowId);
    const ids = [...new Set([current.id, ...(restored ? [restored.id] : [])])];
    const groupId = await this.browser.group(ids);
    next = { ...next, pending: { ...next.pending!, createdGroupId: groupId } };
    await this.repo.save(next);
    await this.browser.updateGroup(groupId, { title: d.title, color: d.color, collapsed: false });
    const group = (await this.browser.groups()).find((g) => g.id === groupId);
    if (!group || !ids.every((id) => group.tabIds.includes(id)))
      throw new AppError(
        'VERIFY',
        'The new group could not be verified. Resolve the interrupted recovery in settings.',
      );
    next = assign(
      next,
      {
        ...d,
        lastSeenAt: this.now(),
        binding: { epoch, groupId, windowId: group.windowId, tabIds: group.tabIds },
      },
      true,
    );
    await this.repo.save({ ...next, pending: null });
    await this.browser.activate(current.id, group.windowId);
    const notice = original
      ? await rememberMove(
          this.repo,
          this.browser,
          original,
          d,
          epoch,
          this.now(),
          `Recreated ${d.title || 'Untitled group'}. Previous tabs were not restored${restored ? ' except your selected tab' : ''}.`,
        )
      : undefined;
    return {
      ok: true,
      ...(notice ? { notice } : {}),
      outcome: restored
        ? 'Destination recreated with one recovered tab. Other previous tabs were not restored.'
        : 'Destination recreated. Previous tabs were not restored.',
      state: await this.view(false),
    };
  }
}

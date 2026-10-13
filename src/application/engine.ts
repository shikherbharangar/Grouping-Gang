import type { BrowserGateway } from '../browser/gateway';
import { assign, transfer } from '../domain/assignment';
import { AppError, errorMessage } from '../domain/errors';
import { reconcile, resolve } from '../domain/identity';
import type { Repository } from '../storage/repository';
import type {
  BrowserTab,
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
  dispatch(command: Command): Promise<Result> {
    return this.serialize(async () => {
      try {
        return await this.execute(command);
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
    const next = reconcile(registry, groups, epoch, this.now());
    if (JSON.stringify(next) !== JSON.stringify(registry)) await this.repo.save(next);
    return { registry: next, groups, epoch };
  }
  private async view(capture: boolean): Promise<StateView> {
    const { registry, groups, epoch } = await this.refresh();
    const tab = capture ? await this.browser.activeTab() : null;
    return {
      destinations: registry.destinations.map((d) => resolve(d, groups, epoch, registry.pending)),
      groups,
      theme: registry.theme,
      context: tab ? { tabId: tab.id, windowId: tab.windowId } : null,
      tabTitle: tab?.title || '',
      shortcut: await this.browser.shortcut(),
      version: '1.0.0',
    };
  }
  private async intendedTab(context: TabContext): Promise<BrowserTab> {
    const tab = await this.browser.tab(context.tabId);
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
  private async move(context: TabContext, group: LiveGroup): Promise<void> {
    const tab = await this.intendedTab(context);
    if (!(await this.browser.normalWindow(group.windowId)))
      throw new AppError('WINDOW', 'The destination window is no longer available.');
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
  }
  private async execute(command: Command): Promise<Result> {
    if (command.type === 'reset') {
      await this.repo.reset();
      return { ok: true, state: await this.view(false) };
    }
    if (command.type === 'state')
      return { ok: true, state: await this.view(command.capture === true) };
    if (command.type === 'sessions') return { ok: true, sessions: await this.browser.sessions() };
    const { registry, groups, epoch } = await this.refresh();
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
      let next = assign(registry, d, command.replace);
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
        throw new AppError(
          view.interrupted ? 'INTERRUPTED' : view.state.toUpperCase(),
          view.interrupted
            ? 'A recovery was interrupted. Bind the resulting group in settings before trying again.'
            : view.state === 'ambiguous'
              ? 'This destination needs confirmation. Choose its group in settings.'
              : 'This destination is missing. Recreate it or recover a closed tab.',
        );
      await this.move(command.context, view.group);
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
      if (command.context) await this.move(command.context, view.group);
      return {
        ok: true,
        outcome: 'The original live group was already available.',
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
    return {
      ok: true,
      outcome: restored
        ? 'Destination recreated with one recovered tab. Other previous tabs were not restored.'
        : 'Destination recreated. Previous tabs were not restored.',
      state: await this.view(false),
    };
  }
}

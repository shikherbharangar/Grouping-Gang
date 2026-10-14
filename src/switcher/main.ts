import './switcher.css';
import { el, readState, required, onBrowserChange, send } from '../shared/client';
import { initializeTheme } from '../shared/theme';
import { SLOTS } from '../shared/types';
import type {
  Slot,
  StateView,
  TabContext,
  DestinationView,
  ProposedAssignment,
  Notice,
} from '../shared/types';
import { numberKey, nextIndex } from './keyboard';
import { search } from '../domain/search';
import { propose } from '../domain/setup';
import { errorMessage } from '../domain/errors';
import { parseRegistry } from '../storage/schema';
const list = required<HTMLElement>('#slots');
const input = required<HTMLInputElement>('#search');
const status = required<HTMLElement>('#status');
let state: StateView | null = null;
let context: TabContext | null = null;
let selectedId: string | null = null;
let results: DestinationView[] = [];
let busy = false;
let queuedNumber: Slot | null = null;
let queuedEnter = false;
let dismissed = false;
let proposal: ProposedAssignment[] = [];
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}
function renderResults(): void {
  if (!state || !state.setupCompleted) return;
  required('.search-hint').textContent = input.value ? 'esc' : '1–0';
  results = search(state.destinations, input.value);
  if (!results.some((d) => d.id === selectedId)) selectedId = results[0]?.id ?? null;
  const fragment = document.createDocumentFragment();
  for (const d of results) {
    const button = el('button', `slot${selectedId === d.id ? ' selected' : ''}`);
    button.id = `slot-${d.slot}`;
    button.dataset.slot = String(d.slot);
    button.dataset.state = d.state;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(selectedId === d.id));
    button.tabIndex = -1;
    const title = d.title || 'Untitled group';
    button.title = title;
    const label = d.interrupted
      ? 'Interrupted'
      : d.state === 'ambiguous'
        ? 'Confirm group'
        : d.state === 'missing'
          ? 'Recreate'
          : d.group?.collapsed
            ? 'Collapsed'
            : d.group?.windowId !== context?.windowId
              ? 'Other window'
              : '';
    button.setAttribute('aria-label', `${d.slot}. ${title}${label ? `. ${label}` : ''}`);
    const dot = el('span', 'dot');
    dot.dataset.color = d.color;
    dot.setAttribute('aria-hidden', 'true');
    button.append(
      el('span', 'number', String(d.slot)),
      dot,
      el('span', 'slot-title', title),
      el('span', 'slot-state', label),
    );
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      void activate(d.slot);
    });
    fragment.append(button);
  }
  list.replaceChildren(fragment);
  const selected = results.find((d) => d.id === selectedId);
  if (selected) input.setAttribute('aria-activedescendant', `slot-${selected.slot}`);
  else input.removeAttribute('aria-activedescendant');
  const empty = required('#empty');
  empty.toggleAttribute('hidden', results.length > 0);
  empty.textContent = input.value.trim()
    ? 'No matching destinations. Try another name.'
    : 'No destinations yet. Assign an open group in settings.';
}
function renderSetup(): void {
  if (!state) return;
  const setup = required('#setup');
  setup.toggleAttribute('hidden', state.setupCompleted);
  input.disabled = !state.setupCompleted;
  if (state.setupCompleted) return;
  proposal = propose(state.groups, context?.windowId ?? null);
  const content = required('#proposal');
  content.replaceChildren();
  if (!state.groups.length)
    content.append(
      el(
        'p',
        'secondary small',
        'No groups are open yet. Start now and new groups can receive a free number.',
      ),
    );
  for (const slot of SLOTS) {
    if (!state.groups.length) break;
    const row = el('div', 'proposal-row');
    const label = el('label', 'number', String(slot));
    label.htmlFor = `proposal-${slot}`;
    const select = el('select');
    select.id = label.htmlFor;
    select.setAttribute('aria-label', `Group for number ${slot}`);
    select.append(new Option('Leave available', ''));
    for (const g of state.groups)
      select.append(
        new Option(
          `${g.title || 'Untitled group'} · Window ${g.windowId} · #${g.id}`,
          String(g.id),
        ),
      );
    select.value = String(proposal.find((a) => a.slot === slot)?.groupId ?? '');
    select.addEventListener('change', () => {
      const oldGroupId = proposal.find((a) => a.slot === slot)?.groupId;
      const chosen = select.value ? Number(select.value) : null;
      const other = proposal.find((a) => a.groupId === chosen && a.slot !== slot);
      proposal = proposal.filter((a) => a.slot !== slot && a.slot !== other?.slot);
      if (chosen !== null) proposal.push({ slot, groupId: chosen });
      if (other) {
        if (oldGroupId !== undefined) proposal.push({ slot: other.slot, groupId: oldGroupId });
        required<HTMLSelectElement>(`#proposal-${other.slot}`).value = String(oldGroupId ?? '');
      }
    });
    row.append(label, select);
    content.append(row);
  }
  required('#accept-setup').textContent = state.groups.length
    ? 'Use these numbers'
    : 'Start with empty numbers';
  required('#slots').replaceChildren();
  required('#empty').toggleAttribute('hidden', true);
}
function displayNotice(notice: Notice | null): void {
  clearTimeout(noticeTimer);
  const bar = required<HTMLElement>('#notice');
  bar.toggleAttribute('hidden', !notice || notice.expiresAt <= Date.now());
  if (!notice || notice.expiresAt <= Date.now()) return;
  required('#notice-text').textContent = notice.message;
  required<HTMLButtonElement>('#notice-undo').onclick = () => {
    void operation(async () => {
      await send({ type: notice.kind === 'move' ? 'undo' : 'undo-assignment', id: notice.id });
      notify('Undone.');
      await refresh();
    });
  };
  required<HTMLButtonElement>('#dismiss-notice').onclick = () => {
    bar.hidden = true;
    void send({ type: 'dismiss-notice', id: notice.id }).catch((e) =>
      notify(errorMessage(e), true),
    );
  };
  noticeTimer = setTimeout(() => {
    bar.hidden = true;
  }, notice.expiresAt - Date.now());
}
function renderUndo(): void {
  clearTimeout(undoTimer);
  const remaining: number[] = [];
  for (const [selector, record, type] of [
    ['#undo', state?.undo, 'undo'],
    ['#undo-assignment', state?.assignmentUndo, 'undo-assignment'],
  ] as const) {
    const button = required<HTMLButtonElement>(selector);
    button.hidden = !record || record.expiresAt <= Date.now();
    if (!record || record.expiresAt <= Date.now()) continue;
    remaining.push(record.expiresAt - Date.now());
    button.onclick = () => {
      void operation(async () => {
        await send({ type, id: record.id });
        notify(type === 'undo' ? 'Move undone.' : 'Automatic assignment undone.');
        await refresh();
        input.focus();
      });
    };
  }
  if (remaining.length) undoTimer = setTimeout(renderUndo, Math.min(...remaining));
}
async function refresh(): Promise<void> {
  if (dismissed) return;
  state = await readState();
  renderResults();
  renderUndo();
  displayNotice(state.notice);
}
async function operation(work: () => Promise<void>): Promise<void> {
  if (busy || dismissed) return;
  busy = true;
  list.setAttribute('aria-busy', 'true');
  try {
    await work();
  } catch (error) {
    notify(errorMessage(error), true);
    try {
      await refresh();
      if (state && !state.setupCompleted) renderSetup();
    } catch (e) {
      notify(errorMessage(e), true);
    }
  } finally {
    busy = false;
    list.removeAttribute('aria-busy');
  }
}
async function activate(slot: Slot): Promise<void> {
  if (busy || dismissed) return;
  if (!state) {
    queuedNumber = slot;
    return;
  }
  const d = state.destinations.find((d) => d.slot === slot);
  if (d) {
    selectedId = d.id;
    renderResults();
  }
  if (!d) {
    notify(`Number ${slot} is unassigned. Choose a group in Settings.`);
    return;
  }
  if (d.interrupted || d.state === 'ambiguous') {
    notify('Confirm the intended group before moving this tab.', true);
    required('#resolve').removeAttribute('hidden');
    return;
  }
  if (!context) {
    notify('No source tab is available. Reopen from a webpage.', true);
    return;
  }
  await operation(async () => {
    if (d.state === 'missing') notify(`Recreating ${d.title || 'destination'}…`);
    await send({ type: 'move', slot, context: context! });
    dismissed = true;
    window.close();
  });
}
function moveSelection(direction: number): void {
  if (!results.length) return;
  const index = results.findIndex((d) => d.id === selectedId);
  selectedId =
    results[nextIndex(Math.max(0, index), direction < 0 ? 'ArrowUp' : 'ArrowDown', results.length)]!
      .id;
  renderResults();
  const d = results.find((d) => d.id === selectedId);
  if (d) document.getElementById(`slot-${d.slot}`)?.scrollIntoView({ block: 'nearest' });
}
input.addEventListener('input', () => {
  notify('');
  required('#resolve').setAttribute('hidden', '');
  renderResults();
});
// Active immediately, independent of theme, state I/O or entrance motion.
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (input.value) {
      input.value = '';
      renderResults();
      input.focus();
    } else {
      dismissed = true;
      queuedNumber = null;
      queuedEnter = false;
      window.close();
    }
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (state && !state.setupCompleted) return;
  const inSearch =
    event.target === input ||
    event.target === document.body ||
    (event.target instanceof HTMLElement && !!event.target.closest('#slots'));
  if (!inSearch) return;
  const slot = input.value === '' ? numberKey(event.key) : null;
  if (slot !== null) {
    event.preventDefault();
    if (!event.repeat) void activate(slot);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(event.key === 'ArrowUp' ? -1 : 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (event.repeat) return;
    if (!state) queuedEnter = true;
    else {
      const d = results.find((d) => d.id === selectedId);
      if (d) void activate(d.slot);
    }
  }
});
function openSettings(): void {
  void chrome.runtime.openOptionsPage().catch((e) => notify(errorMessage(e), true));
}
required('#settings').addEventListener('click', openSettings);
required('#resolve').addEventListener('click', openSettings);
required('#accept-setup').addEventListener('click', () => {
  void operation(async () => {
    await send({
      type: 'setup',
      assignments: proposal,
      autoAssign: required<HTMLInputElement>('#setup-auto').checked,
    });
    state = await readState();
    renderSetup();
    renderResults();
    input.focus();
    notify('Ready. Press a number or type a destination.');
  });
});
// Begin the worker/source request before other async work. Named shortcut launches
// hand off the source captured before openPopup; toolbar access keeps active-tab context.
const initial = readState(true);
const loadingTimer = setTimeout(() => {
  if (!state && !dismissed) notify('Checking destinations…');
}, 120);
void initializeTheme().catch((e) => notify(errorMessage(e), true));
input.focus();
// Cached records provide immediate metadata only: they never authorize a move.
void chrome.storage.local
  .get('registry')
  .then((data) => {
    if (state || dismissed) return;
    try {
      const cached = parseRegistry(data.registry);
      const fragment = document.createDocumentFragment();
      for (const slot of SLOTS) {
        const d = cached.destinations.find((d) => d.slot === slot);
        if (!d) continue;
        const row = el('button', 'slot');
        row.disabled = true;
        row.setAttribute('aria-label', `${slot}. ${d.title || 'Untitled group'}. Checking`);
        row.append(
          el('span', 'number', String(slot)),
          el('span', 'slot-title', d.title || 'Untitled group'),
          el('span', 'slot-state', 'Checking'),
        );
        fragment.append(row);
      }
      list.replaceChildren(fragment);
    } catch {
      /* The worker returns the actionable storage error without overwriting data. */
    }
  })
  .catch((e) => notify(errorMessage(e), true));
void initial
  .then(async (next) => {
    clearTimeout(loadingTimer);
    if (dismissed) return;
    state = next;
    context = next.context;
    notify('');
    renderSetup();
    renderResults();
    renderUndo();
    displayNotice(state.notice);
    input.setAttribute(
      'title',
      state.tabTitle ? `Moving: ${state.tabTitle}` : 'Choose a webpage first',
    );
    if (state.setupCompleted) input.focus();
    else required<HTMLButtonElement>('#accept-setup').focus();
    if (state.setupCompleted && queuedNumber !== null) {
      const slot = queuedNumber;
      queuedNumber = null;
      await activate(slot);
    } else if (state.setupCompleted && queuedEnter) {
      queuedEnter = false;
      if (results[0]) await activate(results[0].slot);
    }
  })
  .catch((e) => {
    clearTimeout(loadingTimer);
    list.replaceChildren();
    document.documentElement.classList.add('ready');
    notify(errorMessage(e), true);
    required('#resolve').textContent = 'Open settings';
    required('#resolve').removeAttribute('hidden');
  });
function changed(): void {
  if (!busy && state && !dismissed) void refresh().catch((e) => notify(errorMessage(e), true));
}
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local' || area === 'session') changed();
});
onBrowserChange(changed);

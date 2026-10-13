import './switcher.css';
import { el, readState, required, onBrowserChange } from '../shared/client';
import { send } from '../shared/client';
import { initializeTheme } from '../shared/theme';
import { SLOTS } from '../shared/types';
import type { Slot, StateView, TabContext } from '../shared/types';
import { nextIndex, numberKey } from './keyboard';
import { errorMessage } from '../domain/errors';
import { showRecovery } from '../shared/recovery';
const list = required<HTMLElement>('#slots');
const status = required<HTMLElement>('#status');
let state: StateView | null = null;
let context: TabContext | null = null;
let selected = 0;
let busy = false;
let queuedNumber: Slot | null = null;
let dismissed = false;
function notify(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}
function focusRow(index: number): void {
  selected = index;
  [...list.querySelectorAll<HTMLButtonElement>('button')].forEach((button, i) => {
    button.classList.toggle('selected', i === index);
    button.tabIndex = i === index ? 0 : -1;
    if (i === index) button.focus();
  });
}
function render(): void {
  if (!state) return;
  const fragment = document.createDocumentFragment();
  for (const [index, slot] of SLOTS.entries()) {
    const destination = state.destinations.find((d) => d.slot === slot);
    const button = el(
      'button',
      `slot${index === selected ? ' selected' : ''}${destination ? '' : ' empty'}`,
    );
    button.dataset.slot = String(slot);
    button.dataset.state = destination?.state || 'empty';
    button.tabIndex = index === selected ? 0 : -1;
    const title = destination ? destination.title || 'Untitled group' : 'Assign a group';
    button.title = title;
    const label = !destination
      ? '+'
      : destination.interrupted
        ? 'Interrupted'
        : destination.state === 'ambiguous'
          ? 'Confirm group'
          : destination.state === 'missing'
            ? 'Missing'
            : destination.group?.windowId !== context?.windowId
              ? 'Other window'
              : destination.group?.collapsed
                ? 'Collapsed'
                : '';
    button.setAttribute(
      'aria-label',
      `${slot}. ${title}${label ? `. ${label === '+' ? 'Unassigned' : label}` : ''}`,
    );
    button.append(el('span', 'number', String(slot)));
    const dot = el('span', 'dot');
    dot.dataset.color = destination?.color || 'grey';
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot, el('span', 'slot-title', title), el('span', 'slot-state', label));
    button.addEventListener('focus', () => {
      selected = index;
      list.querySelectorAll('.slot').forEach((b, i) => {
        b.classList.toggle('selected', i === index);
      });
    });
    button.addEventListener('click', () => {
      void activate(slot);
    });
    fragment.append(button);
  }
  list.replaceChildren(fragment);
  if (!state.destinations.length && !status.textContent)
    notify('Start in Edit destinations. Assign a group, then use its number.');
}
async function activate(slot: Slot): Promise<void> {
  if (busy || dismissed) return;
  if (!state) {
    queuedNumber = slot;
    return;
  }
  const destination = state.destinations.find((d) => d.slot === slot);
  if (!destination) {
    notify(`Number ${slot} is unassigned. Open Edit destinations to choose a group.`);
    return;
  }
  if (destination.interrupted || destination.state === 'ambiguous') {
    notify('Confirm this destination’s group in Edit destinations before moving.', true);
    return;
  }
  if (!context) {
    notify('No active tab is available. Reopen the switcher from a webpage.', true);
    return;
  }
  if (destination.state === 'missing') {
    showRecovery(destination, context, () => window.close());
    return;
  }
  busy = true;
  list.setAttribute('aria-busy', 'true');
  try {
    await send({ type: 'move', slot, context });
    window.close();
  } catch (error) {
    notify(errorMessage(error), true);
    try {
      state = await readState();
      render();
    } catch (refreshError) {
      notify(errorMessage(refreshError), true);
    }
  } finally {
    busy = false;
    list.removeAttribute('aria-busy');
  }
}
// Install keyboard handling before asynchronous state/font work finishes.
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    dismissed = true;
    queuedNumber = null;
    window.close();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const slot = numberKey(event.key);
  if (slot !== null) {
    event.preventDefault();
    void activate(slot);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    focusRow(nextIndex(selected, event.key));
  }
  // Native buttons own Enter/Space, so Tab can reach settings without triggering a row.
});
required('#settings').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch((error) => notify(errorMessage(error), true));
});
void (async () => {
  await initializeTheme();
  state = await readState(true);
  context = state.context;
  const title = required('#tab-title');
  title.textContent = state.tabTitle || 'Choose a webpage first';
  title.setAttribute('title', state.tabTitle);
  required('#shortcut').textContent = state.shortcut || 'Set shortcut in settings';
  render();
  focusRow(selected);
  if (queuedNumber !== null && !dismissed) {
    const slot = queuedNumber;
    queuedNumber = null;
    await activate(slot);
  }
})().catch((error) => {
  document.documentElement.classList.add('ready');
  notify(errorMessage(error), true);
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local' || busy || !state || document.querySelector('dialog[open]')) return;
  const activeSlot =
    document.activeElement instanceof HTMLElement ? document.activeElement.dataset.slot : undefined;
  void readState()
    .then((next) => {
      state = next;
      render();
      if (activeSlot !== undefined) focusRow(SLOTS.indexOf(Number(activeSlot) as Slot));
    })
    .catch((error) => notify(errorMessage(error), true));
});

onBrowserChange(() => {
  if (busy || !state || document.querySelector('dialog[open]')) return;
  const activeSlot =
    document.activeElement instanceof HTMLElement ? document.activeElement.dataset.slot : undefined;
  void readState()
    .then((next) => {
      state = next;
      render();
      if (activeSlot !== undefined) focusRow(SLOTS.indexOf(Number(activeSlot) as Slot));
    })
    .catch((error) => notify(errorMessage(error), true));
});

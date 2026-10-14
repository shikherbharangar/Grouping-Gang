import './settings.css';
import { el, readState, required, send, onBrowserChange } from '../shared/client';
import { initializeTheme, applyTheme } from '../shared/theme';
import { SLOTS } from '../shared/types';
import type { Slot, StateView, Theme } from '../shared/types';
import { errorMessage } from '../domain/errors';
import { dialog, confirmAction } from '../shared/dialog';
import { showRecovery } from '../shared/recovery';
let state: StateView | null = null;
const status = required<HTMLElement>('#status');
function notify(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function refresh(): Promise<void> {
  state = await readState();
  render();
}
function render(): void {
  if (!state) return;
  required<HTMLInputElement>('#auto-assign').checked = state.autoAssign;
  required('#version').textContent = `v${state.version}`;
  const list = required('#assignments');
  const focus =
    document.activeElement instanceof HTMLElement ? document.activeElement.dataset.edit : undefined;
  const fragment = document.createDocumentFragment();
  for (const slot of SLOTS) {
    const d = state.destinations.find((d) => d.slot === slot);
    const row = el('div', `assignment${d ? '' : ' empty'}`);
    row.append(el('span', 'number', String(slot)));
    if (d) {
      const dot = el('span', 'dot');
      dot.dataset.color = d.color;
      dot.setAttribute('aria-hidden', 'true');
      row.append(dot);
    }
    const content = el('div', 'assignment-content');
    const title = el('p', 'assignment-title', d ? d.title || 'Untitled group' : 'Available');
    title.title = title.textContent || '';
    content.append(title);
    if (d)
      content.append(
        el(
          'p',
          'assignment-state',
          d.interrupted
            ? 'Interrupted recovery · bind or forget'
            : d.state === 'missing'
              ? 'Missing · your number is reserved'
              : d.state === 'ambiguous'
                ? 'Needs confirmation · choose the correct group'
                : `${d.group?.collapsed ? 'Collapsed' : 'Open'} · Window ${d.group?.windowId}`,
        ),
      );
    const edit = el('button', 'quiet', d ? 'Edit' : 'Assign group +');
    edit.dataset.edit = String(slot);
    edit.setAttribute('aria-label', `${d ? 'Edit' : 'Assign'} number ${slot}`);
    edit.addEventListener('click', () => {
      void editSlot(slot).catch((error) => notify(errorMessage(error), true));
    });
    row.append(content, edit);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
  if (focus !== undefined) list.querySelector<HTMLButtonElement>(`[data-edit="${focus}"]`)?.focus();
  required('#empty-hint').toggleAttribute('hidden', state.destinations.length > 0);
  required('#registry-summary').textContent = `${state.destinations.length} / 10 assigned`;
  required('#shortcut').textContent = state.shortcut || 'No shortcut assigned';
  required('#diagnostics').textContent =
    `Version ${state.version} · ${state.groups.length} open groups · ${state.destinations.filter((d) => d.state === 'missing').length} missing · ${state.destinations.filter((d) => d.state === 'ambiguous').length} need confirmation.`;
  document
    .querySelectorAll<HTMLButtonElement>('[data-theme-choice]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state?.theme)),
    );
}
async function editSlot(slot: Slot): Promise<void> {
  await refresh();
  if (!state) return;
  const d = state.destinations.find((d) => d.slot === slot);
  const modal = dialog(
    d ? `Destination ${slot}` : `Assign number ${slot}`,
    d
      ? 'Choose the exact live group for this number. Rebinding preserves the destination’s identity.'
      : 'Choose an existing group. Duplicate names include their window and browser group ID.',
  );
  const label = el('label', 'field-label', 'Open group');
  label.htmlFor = 'group';
  const select = el('select');
  select.id = 'group';
  select.append(new Option('Choose a group…', ''));
  const assigned = new Map(
    state.destinations
      .filter((item) => item.slot !== slot && item.group)
      .map((item) => [item.group!.id, item.slot]),
  );
  for (const group of state.groups) {
    const other = assigned.get(group.id);
    const option = new Option(
      `${group.title || 'Untitled group'} · Window ${group.windowId} · #${group.id}${other === undefined ? '' : ` · assigned to ${other}`}`,
      String(group.id),
    );
    option.disabled = other !== undefined;
    select.append(option);
  }
  if (d?.group) select.value = String(d.group.id);
  modal.body.append(label, select);
  if (!state.groups.length)
    modal.body.append(
      el(
        'p',
        'secondary small',
        'No groups are open. Create a group in Brave, then close and reopen this dialog.',
      ),
    );
  if (d?.state === 'ambiguous')
    modal.body.append(
      el(
        'p',
        'recovery-note',
        'Similar names are not proof of identity. Choose the group you intend to use; nothing will move until you select the destination in the switcher.',
      ),
    );
  const save = el('button', 'primary', d ? 'Confirm binding' : 'Assign group');
  save.disabled = !select.value;
  select.addEventListener('change', () => {
    save.disabled = !select.value;
  });
  save.addEventListener('click', () =>
    modal.run(async () => {
      if (!select.value) return;
      await send({ type: 'assign', slot, groupId: Number(select.value), replace: !!d });
      modal.close();
      await refresh();
      notify(`Number ${slot} is assigned.`);
    }),
  );
  modal.actions.append(save);
  if (!d) return;
  if (d.state === 'missing' && !d.interrupted) {
    const recover = el('button', '', 'Recreate or recover…');
    recover.addEventListener('click', () => {
      modal.close();
      showRecovery(d, null, (outcome) => {
        notify(outcome);
        void refresh().catch((error) => notify(errorMessage(error), true));
      });
    });
    modal.body.append(recover);
  }
  if (d.interrupted)
    modal.body.append(
      el(
        'p',
        'recovery-note',
        'Recovery stopped partway through. Inspect your groups, then confirm the resulting group above. If none should be kept, forget this number before assigning it again.',
      ),
    );
  const numbering = el('div', 'subsection');
  const moveLabel = el('label', 'field-label', 'Change number (occupied numbers swap)');
  moveLabel.htmlFor = 'new-slot';
  const inline = el('div', 'inline');
  const numbers = el('select');
  numbers.id = 'new-slot';
  for (const target of SLOTS) numbers.append(new Option(String(target), String(target)));
  numbers.value = String(slot);
  const move = el('button', '', 'Move number');
  move.addEventListener('click', () =>
    modal.run(async () => {
      await send({ type: 'transfer', from: slot, to: Number(numbers.value) as Slot });
      modal.close();
      await refresh();
      notify('Number assignments updated.');
    }),
  );
  inline.append(numbers, move);
  numbering.append(moveLabel, inline);
  modal.body.append(numbering);
  const forget = el('button', 'danger', 'Forget this destination…');
  forget.addEventListener('click', () => {
    modal.close();
    confirmAction(
      `Forget number ${slot}?`,
      'This removes the assignment. The browser group and its tabs stay where they are.',
      'Forget destination',
      async () => {
        await send({ type: 'forget', slot });
        await refresh();
        notify(`Number ${slot} is available.`);
      },
    );
  });
  modal.body.append(forget);
}
required('#refresh').addEventListener('click', () => {
  void refresh()
    .then(() => notify('Groups refreshed.'))
    .catch((error) => notify(errorMessage(error), true));
});
required('#shortcuts').addEventListener('click', () => {
  void chrome.tabs
    .create({ url: 'chrome://extensions/shortcuts' })
    .catch(() =>
      notify('Enter brave://extensions/shortcuts in the address bar to change the shortcut.'),
    );
});
required('#reset').addEventListener('click', () =>
  confirmAction(
    'Reset Grouping Gang?',
    'All ten assignments and your appearance preference will be reset. Browser tabs and groups stay open.',
    'Reset assignments',
    async () => {
      await send({ type: 'reset' });
      await refresh();
      notify('Assignments reset. Your groups are unchanged.');
    },
  ),
);
document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) =>
  button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice as Theme;
    void send({ type: 'theme', theme })
      .then(() => {
        applyTheme(theme, true);
        if (state) state.theme = theme;
        render();
      })
      .catch((error) => notify(errorMessage(error), true));
  }),
);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void refresh().catch((error) => notify(errorMessage(error), true));
});
void initializeTheme()
  .then(refresh)
  .catch((error) => {
    document.documentElement.classList.add('ready');
    notify(errorMessage(error), true);
  });

onBrowserChange(() => {
  void refresh().catch((error) => notify(errorMessage(error), true));
});

required<HTMLInputElement>('#auto-assign').addEventListener('change', (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  void send({ type: 'auto-assign', enabled })
    .then(() => {
      if (state) state.autoAssign = enabled;
      notify(
        enabled ? 'New groups will receive the next free number.' : 'Automatic assignment is off.',
      );
    })
    .catch((error) => {
      if (state) required<HTMLInputElement>('#auto-assign').checked = state.autoAssign;
      notify(errorMessage(error), true);
    });
});

import type { DestinationView, TabContext } from './types';
import { dialog } from './dialog';
import { el, send } from './client';
import { errorMessage } from '../domain/errors';
export function showRecovery(
  destination: DestinationView,
  context: TabContext | null,
  done: (outcome: string) => void,
): void {
  const modal = dialog(
    `Bring back ${destination.title || 'Untitled group'}`,
    context
      ? 'Recreate this destination with your current tab. Previous tabs stay closed unless you select one to recover.'
      : 'Recreate this destination with a blank tab, or choose one recently closed tab to recover.',
  );
  const note = el(
    'p',
    'recovery-note',
    'Chromium cannot restore a saved group by identity. Only individual closed tabs can be recovered here.',
  );
  const label = el('label', 'field-label', 'Recover one closed tab (optional)');
  label.htmlFor = 'closed-tab';
  const select = el('select');
  select.id = 'closed-tab';
  select.append(new Option('No previous tab — recreate only', ''));
  const status = el('p', 'secondary small', 'Checking recently closed tabs…');
  status.setAttribute('role', 'status');
  modal.body.append(note, label, select, status);
  const button = el('button', 'primary', 'Recreate destination');
  select.addEventListener('change', () => {
    button.textContent = select.value ? 'Recover tab & recreate' : 'Recreate destination';
  });
  button.addEventListener('click', () =>
    modal.run(async () => {
      button.textContent = 'Recreating…';
      try {
        const response = await send({
          type: 'recover',
          slot: destination.slot,
          context,
          ...(select.value ? { sessionId: select.value } : {}),
        });
        modal.close();
        done(response.outcome || 'Destination recreated.');
      } finally {
        button.textContent = select.value ? 'Recover tab & recreate' : 'Recreate destination';
      }
    }),
  );
  modal.actions.append(button);
  void send({ type: 'sessions' })
    .then((response) => {
      for (const session of response.sessions || [])
        select.append(new Option(session.title, session.sessionId));
      status.textContent = response.sessions?.length
        ? 'Only the selected tab will reopen. Window sessions are excluded.'
        : 'No individual closed tabs are available. You can still recreate the destination.';
    })
    .catch((error) => {
      status.textContent = `Session lookup failed: ${errorMessage(error)} You can still recreate the destination.`;
    });
}

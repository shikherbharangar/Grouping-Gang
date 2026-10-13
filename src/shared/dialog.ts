import { el } from './client';
import { errorMessage } from '../domain/errors';
export function dialog(
  title: string,
  description: string,
): {
  root: HTMLDialogElement;
  body: HTMLElement;
  actions: HTMLElement;
  error: HTMLElement;
  close: () => void;
  run: (operation: () => Promise<void>) => void;
} {
  const previous = document.activeElement;
  const root = el('dialog', 'dialog');
  const heading = el('h2', '', title);
  heading.id = 'dialog-title';
  root.setAttribute('aria-labelledby', heading.id);
  const intro = el('p', 'secondary', description);
  const body = el('div', 'dialog-body');
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  const actions = el('div', 'dialog-actions');
  const cancel = el('button', 'quiet', 'Cancel');
  function close(): void {
    root.close();
    root.remove();
    if (previous instanceof HTMLElement) {
      if (previous.isConnected) previous.focus();
      else {
        const attribute = previous.dataset.edit !== undefined ? 'data-edit' : 'data-slot';
        const value = previous.getAttribute(attribute);
        if (value !== null && /^[0-9]$/.test(value))
          document.querySelector<HTMLElement>(`[${attribute}="${value}"]`)?.focus();
      }
    }
  }
  cancel.addEventListener('click', close);
  root.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!root.hasAttribute('aria-busy')) close();
  });
  actions.append(cancel);
  root.append(heading, intro, body, error, actions);
  document.body.append(root);
  root.showModal();
  return {
    root,
    body,
    actions,
    error,
    close,
    run: (operation) => {
      if (root.hasAttribute('aria-busy')) return;
      root.setAttribute('aria-busy', 'true');
      error.textContent = '';
      const controls = [
        ...root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select'),
      ];
      const disabled = controls.map((c) => c.disabled);
      controls.forEach((c) => {
        c.disabled = true;
      });
      void operation()
        .catch((e) => {
          error.textContent = errorMessage(e);
        })
        .finally(() => {
          root.removeAttribute('aria-busy');
          controls.forEach((c, index) => {
            c.disabled = disabled[index] ?? false;
          });
        });
    },
  };
}
export function confirmAction(
  title: string,
  description: string,
  label: string,
  action: () => Promise<void>,
): void {
  const modal = dialog(title, description);
  const confirm = el('button', 'danger', label);
  confirm.addEventListener('click', () =>
    modal.run(async () => {
      await action();
      modal.close();
    }),
  );
  modal.actions.append(confirm);
}

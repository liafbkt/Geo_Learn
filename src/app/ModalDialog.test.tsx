import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModalDialog } from './ModalDialog';

it('moves focus into the modal, traps Tab, and restores prior focus', () => {
  const launcher = document.createElement('button');
  document.body.append(launcher);
  launcher.focus();
  const view = render(
    <ModalDialog labelledBy="modal-title" className="test-modal">
      <h2 id="modal-title">测试模态框</h2>
      <button type="button">第一项</button>
      <button type="button">最后一项</button>
    </ModalDialog>,
  );
  const dialog = screen.getByRole('dialog', { name: '测试模态框' });
  const first = screen.getByRole('button', { name: '第一项' });
  const last = screen.getByRole('button', { name: '最后一项' });

  expect(first).toHaveFocus();
  last.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(first).toHaveFocus();
  first.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();

  view.unmount();
  expect(launcher).toHaveFocus();
  launcher.remove();
});

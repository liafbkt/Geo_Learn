import { ModalDialog } from './ModalDialog';

type Props = Readonly<{
  onResume: () => void;
  onOpenOptions: () => void;
  onReturnHome: () => void;
  waitingForSave?: boolean;
}>;

export function PauseDialog({ onResume, onOpenOptions, onReturnHome, waitingForSave = false }: Props) {
  return (
    <ModalDialog labelledBy="pause-title" className="pause-card">
      <p className="pause-card__eyebrow">航图已暂存</p>
      <h2 id="pause-title">练习已暂停</h2>
      <p>计时已经停止。返回后会从当前题继续。</p>
      <div className="pause-card__actions">
        <button type="button" className="primary-action" onClick={onResume}>继续</button>
        <button type="button" onClick={onOpenOptions}>选项</button>
        <button type="button" onClick={onReturnHome} disabled={waitingForSave}>
          {waitingForSave ? '正在保存…' : '返回主菜单'}
        </button>
      </div>
    </ModalDialog>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = Readonly<{
  children: ReactNode;
  onRestart: () => void;
  onExportDiagnostics: () => void;
}>;

type State = Readonly<{ failed: boolean }>;

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI-UNEXPECTED', error.name, info.componentStack ? 'component-stack' : '');
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-boundary" role="alert">
        <section className="error-boundary__card">
          <p className="error-boundary__eyebrow">空间记忆教练</p>
          <h1>应用暂时无法继续</h1>
          <p>学习数据仍保存在本机。请重新启动；如果问题再次出现，可以导出不含个人路径的诊断信息。</p>
          <p className="error-boundary__code">错误代码：UI-UNEXPECTED</p>
          <div className="error-boundary__actions">
            <button type="button" onClick={this.props.onExportDiagnostics}>导出诊断信息</button>
            <button type="button" className="primary-action" onClick={this.props.onRestart}>重新启动</button>
          </div>
        </section>
      </main>
    );
  }
}

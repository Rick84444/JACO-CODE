import * as React from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { isStaleBuildError, reloadForNewBuild } from '../lib/staleBuild.ts';

// Without a boundary, one exception while rendering unmounts the whole app and leaves an empty page.
// This shows what failed, keeps the text copyable, and offers a reload.
type State = { error: Error | null; where: string };

export class CrashGuard extends React.Component<{ children: ReactNode }, State> {
  declare props: { children: ReactNode };
  declare setState: (patch: Partial<State>) => void;
  state: State = { error: null, where: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, where: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ where: String(info.componentStack || '').split('\n').filter(Boolean).slice(0, 6).join('\n') });
    console.error('JACO screen crashed', error, info.componentStack);
    if (isStaleBuildError(error)) reloadForNewBuild();
  }

  render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;
    const report = `${error.name}: ${error.message}\n${where}`;
    return (
      <div role="alert" style={{ minHeight: '100vh', background: '#101113', color: '#eaebed', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>The screen stopped working</h1>
        <p style={{ marginBottom: 12, color: '#bdbec0' }}>Your missions and settings are safe: they live in the runtime, not in this page. Reload to continue, and send the text below if it keeps happening.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#292a2c', border: '1px solid #374151', borderRadius: 8, padding: 12, maxHeight: 280, overflow: 'auto', userSelect: 'all' }}>{report}</pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 14px', borderRadius: 6, background: '#2563eb', color: '#fff', border: 0 }}>Reload</button>
          <button type="button" onClick={() => { try { void navigator.clipboard.writeText(report); } catch { /* the text is selectable */ } }} style={{ padding: '8px 14px', borderRadius: 6, background: '#404143', color: '#eaebed', border: '1px solid #374151' }}>Copy error</button>
        </div>
      </div>
    );
  }
}

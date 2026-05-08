import React from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { clearSession } from '../session';

interface State { error: Error | null }

export class AuthErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[auth-gate] uncaught', error, info.componentStack);
    try { (window as { __sentry?: { reportError: (e: unknown, ctx?: unknown) => void } }).__sentry?.reportError(error, { stage: 'auth-gate' }); } catch { /* noop */ }
  }

  reset = async () => {
    clearSession();
    try { await signOut(auth); } catch { /* noop */ }
    // Wipe Firebase's IndexedDB persistence too — a stuck multi-factor session
    // or partial-signin state can otherwise survive a sign-out and re-throw on
    // the next page load.
    try {
      const dbs = (await (indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> }).databases?.()) ?? [];
      for (const info of dbs) {
        if (info.name && /^firebase|firestore/i.test(info.name)) {
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(info.name as string);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    } catch { /* noop */ }
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ag-overlay">
        <div className="ag-shell">
          <div className="ag-card">
            <header className="ag-header">
              <div className="ag-brand">
                <span className="ag-brand-name">wardround.app</span>
                <span className="ag-brand-sub">Clinical notes &amp; tasks</span>
              </div>
              <h1 className="ag-title">Something went wrong</h1>
              <p className="ag-subtitle">
                The sign-in screen ran into an error. Resetting your session and reloading
                usually clears it.
              </p>
            </header>
            <div className="ag-body">
              <pre className="ag-code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {String(this.state.error?.message || this.state.error)}
              </pre>
              <div className="ag-actions">
                <button type="button" className="ag-btn ag-btn-primary" onClick={this.reset}>
                  Reset and reload
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

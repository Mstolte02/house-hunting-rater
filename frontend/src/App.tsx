import { FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  canEdit, lockEditing, sharedConfigured, sharedStatus, subscribeShared,
  unlockEditing, validateEditorSession,
} from "./lib/shared";

export default function App() {
  const [, redraw] = useState(0);
  const [showUnlock, setShowUnlock] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeShared(() => redraw((value) => value + 1));
    validateEditorSession();
    return unsubscribe;
  }, []);

  async function submitUnlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlockEditing(password);
      setPassword("");
      setShowUnlock(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not unlock editing.");
    } finally { setBusy(false); }
  }

  const configured = sharedConfigured();
  const editable = canEdit();
  const status = sharedStatus();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          House Hunt<span>Mark &amp; Rachel</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Properties</NavLink>
          <NavLink to="/add">Add</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/tuning">Tuning</NavLink>
        </nav>
        {configured && (
          <button
            className={`access-control ${editable ? "editing" : ""}`}
            onClick={() => editable ? lockEditing() : setShowUnlock(true)}
            title={editable ? "Lock changes on this device" : "Enter the editor password"}
          >
            <span className={`sync-dot ${status}`} />
            {editable ? "Editing · Lock" : "Read only · Unlock"}
          </button>
        )}
      </header>
      <Outlet />
      {showUnlock && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowUnlock(false)}>
          <section className="unlock-dialog" role="dialog" aria-modal="true" aria-labelledby="unlock-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="eyebrow">Shared access</div>
            <h2 id="unlock-title">Unlock editing</h2>
            <p>Anyone can view the house hunt. Enter the shared password to make changes that stick for everyone.</p>
            <form onSubmit={submitUnlock}>
              <label htmlFor="editor-password">Password</label>
              <input id="editor-password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              {error && <div className="err">{error}</div>}
              <div className="dialog-actions">
                <button type="button" className="btn ghost" onClick={() => setShowUnlock(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

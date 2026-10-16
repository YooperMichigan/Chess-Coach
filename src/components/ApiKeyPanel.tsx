import { useEffect, useState, type FormEvent } from 'react';
import { apiKey } from '../platform';

const DISMISSED_PREF = 'chess-coach:apiKeyPromptDismissed';

/**
 * The API key, where the app holds it itself (the iPad build keeps it in the Keychain). Shows a
 * prompt on first launch and a settings section with the masked key. Renders nothing when the
 * server holds the key.
 */
export function ApiKeyPanel() {
  const [masked, setMasked] = useState<string | null | undefined>(undefined); // undefined = loading
  const [prompting, setPrompting] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    void apiKey.masked().then((m) => {
      setMasked(m);
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISSED_PREF) === '1';
      } catch {
        // storage unavailable: just ask again
      }
      if (!m && !dismissed) setPrompting(true);
    });
  }, []);

  if (!apiKey) return null;

  async function refresh() {
    setMasked(await apiKey!.masked());
  }

  function dismissPrompt() {
    setPrompting(false);
    try {
      localStorage.setItem(DISMISSED_PREF, '1');
    } catch {
      // fine: the prompt shows again next launch
    }
  }

  async function remove() {
    if (!window.confirm('Remove the API key from this iPad? The coach stops working until you add one again.')) return;
    await apiKey!.remove();
    await refresh();
  }

  return (
    <>
      <details className="brief api-key">
        <summary>
          API key <span className="brief-state">{masked === undefined ? '' : masked ? 'saved' : 'not set'}</span>
        </summary>
        <p className="brief-help">
          The coach calls Claude directly from this iPad with your Anthropic API key. It is kept in the iPad's Keychain and
          is never shown in full again.
        </p>
        {masked && !editing && (
          <div className="brief-actions">
            <code className="key-masked">{masked}</code>
            <button onClick={() => setEditing(true)}>Replace key</button>
            <button className="danger" onClick={() => void remove()}>
              Remove key
            </button>
          </div>
        )}
        {(!masked || editing) && (
          <KeyForm
            onSaved={async () => {
              setEditing(false);
              await refresh();
            }}
            onCancel={editing ? () => setEditing(false) : undefined}
          />
        )}
      </details>

      {prompting && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
          <div className="modal">
            <h2 id="api-key-title">Add your Anthropic API key</h2>
            <p>
              The coach needs an API key to talk to Claude. Use a key made just for this app, with a low spend limit. It is
              stored in this iPad's Keychain and sent only to Anthropic.
            </p>
            <p className="muted">You can play without it: Stockfish, saving and your history all work offline.</p>
            <KeyForm
              autoFocus
              onSaved={async () => {
                setPrompting(false);
                await refresh();
              }}
              onCancel={dismissPrompt}
              cancelLabel="Not now"
            />
          </div>
        </div>
      )}
    </>
  );
}

function KeyForm({
  onSaved,
  onCancel,
  cancelLabel = 'Cancel',
  autoFocus,
}: {
  onSaved: () => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || state === 'checking') return;
    setState('checking');
    try {
      await apiKey!.replace(draft);
      setDraft(''); // don't keep the key around in the page
      setState('idle');
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the key.');
      setState('error');
    }
  }

  return (
    <form className="key-form" onSubmit={(e) => void submit(e)}>
      <input
        id="api-key-input"
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="sk-ant-…"
        aria-label="Anthropic API key"
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => {
          setDraft(e.target.value);
          if (state === 'error') setState('idle');
        }}
      />
      <div className="brief-actions">
        <button type="submit" disabled={!draft.trim() || state === 'checking'}>
          {state === 'checking' ? 'Checking…' : 'Check and save'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        {state === 'error' && <span className="brief-error">{error}</span>}
      </div>
    </form>
  );
}

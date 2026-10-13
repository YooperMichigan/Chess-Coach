import { useEffect, useState } from 'react';
import { fetchCoachingBrief, saveCoachingBrief } from '../coach/api';

const MAX = 1500;
const EXAMPLE =
  'e.g. I\'m returning to chess and want to reach about 1500. Focus on tactics and not hanging pieces. ' +
  'Ask me a question before telling me the answer. Be blunt. In the opening, check I\'m sticking to my London and Dragon plans.';

/** The player's brief for the coach: goals and coaching style, added to every coach prompt. */
export function CoachingBrief() {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCoachingBrief()
      .then((b) => {
        setSaved(b);
        setDraft(b);
        setState('idle');
      })
      .catch((e: Error) => {
        setError(e.message);
        setState('error');
      });
  }, []);

  async function save() {
    setState('saving');
    try {
      const b = await saveCoachingBrief(draft);
      setSaved(b);
      setDraft(b);
      setState('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setState('error');
    }
  }

  const dirty = draft.trim() !== saved;
  return (
    <details className="brief">
      <summary>
        Coaching brief <span className="brief-state">{saved ? 'set' : 'not set'}</span>
      </summary>
      <p className="brief-help">
        Tell the coach what you want from it, like briefing a trainer: your goals, what to focus on, and how you like to be
        coached. It's added to every comment, hint, chat answer and review. The coach still takes all chess facts from
        Stockfish.
      </p>
      <textarea
        id="coaching-brief"
        rows={5}
        maxLength={MAX}
        placeholder={EXAMPLE}
        value={draft}
        disabled={state === 'loading'}
        onChange={(e) => {
          setDraft(e.target.value);
          if (state === 'saved') setState('idle');
        }}
      />
      <div className="brief-actions">
        <button onClick={() => void save()} disabled={!dirty || state === 'saving' || state === 'loading'}>
          {state === 'saving' ? 'Saving…' : 'Save brief'}
        </button>
        <span className="brief-count">
          {draft.length}/{MAX}
        </span>
        {state === 'saved' && <span className="brief-ok">Saved. The coach uses it from the next call.</span>}
        {state === 'error' && <span className="brief-error">{error}</span>}
      </div>
    </details>
  );
}

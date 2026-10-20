import React, { useState } from 'react';

export function CopyMessageButton({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  return <div className="cognitive-copy-message">
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setManual(false); setStatus('Hela svaret kopierades.'); }
      catch { setManual(true); setStatus('Automatisk kopiering kunde inte bekräftas. Markera och kopiera texten nedan.'); }
    }}>Kopiera hela svaret</button>
    {status && <small role="status">{status}</small>}
    {manual && <textarea aria-label="Hela svaret för manuell kopiering" readOnly value={text} onFocus={event => event.currentTarget.select()}/>}
  </div>;
}

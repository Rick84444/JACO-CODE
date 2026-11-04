import React, { useState } from 'react';

export function CopyMessageButton({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  return <div className="cognitive-copy-message">
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setManual(false); setStatus('The full response was copied.'); }
      catch { setManual(true); setStatus('Automatic copying could not be confirmed. Select and copy the text below.'); }
    }}>Copy full response</button>
    {status && <small role="status">{status}</small>}
    {manual && <textarea aria-label="Full response for manual copying" readOnly value={text} onFocus={event => event.currentTarget.select()}/>}
  </div>;
}

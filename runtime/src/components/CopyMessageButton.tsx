import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useState } from 'react';

export function CopyMessageButton({ text }: { text: string }) {
  const { t: uiText } = useUiLanguage();
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  return <div className="cognitive-copy-message">
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setManual(false); setStatus(uiText("The full answer was copied.")); }
      catch { setManual(true); setStatus(uiText("Automatic copying could not be confirmed. Select and copy the text below.")); }
    }}>{uiText("Copy full answer")}</button>
    {status && <small role="status">{status}</small>}
    {manual && <textarea aria-label={uiText("Full answer for manual copying")} readOnly value={text} onFocus={event => event.currentTarget.select()}/>}
  </div>;
}

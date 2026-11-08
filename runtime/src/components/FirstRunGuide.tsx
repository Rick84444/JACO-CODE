import React, { useState } from 'react';
import { KeyRound, ExternalLink, Loader2, Check, ShieldCheck, HelpCircle, X } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// The first thing a new user sees when no AI model is connected yet. Written for someone who has never used an API:
// what a key is, that it is free, where it is kept, and one paste to finish. Connecting a key was the hardest and most
// frightening step for a beginner (operator 2026-11-07), so this explains instead of assuming.
export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';

type Step = 'intro' | 'paste' | 'done';

export function FirstRunGuide({ onConnected, onClose }: { onConnected: () => void | Promise<void>; onClose: () => void }) {
  const { tr } = useUiLanguage();
  const [step, setStep] = useState<Step>('intro');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [faq, setFaq] = useState<string | null>(null);

  const explain = (state: string) => ({
    KEY_REJECTED: tr('Google sa nej till nyckeln. Kontrollera att du kopierade hela nyckeln (den börjar oftast med AIza) och försök igen.', 'Google did not accept the key. Check that you copied all of it (it usually starts with AIza) and try again.'),
    UNREACHABLE: tr('Datorn fick inget svar från Google. Kontrollera internetanslutningen och försök igen.', 'Your computer got no answer from Google. Check your internet connection and try again.'),
    AMBIGUOUS: tr('JACO kunde inte avgöra vilken tjänst nyckeln hör till. Klistra in en nyckel från Google AI Studio.', 'JACO could not tell which service the key belongs to. Paste a key from Google AI Studio.'),
    UNKNOWN_KEY: tr('Det där ser inte ut som en nyckel från Google AI Studio. Den börjar oftast med AIza.', 'That does not look like a Google AI Studio key. It usually starts with AIza.'),
  } as Record<string, string>)[state] || tr('Något gick fel. Försök igen om en stund.', 'Something went wrong. Try again in a moment.');

  const connect = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setProblem('');
    try {
      const body = await fetch('/api/aura/workbench/providers/key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key.trim(), provider: 'gemini' }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'KEY_FAILED');
      if (body.result?.state !== 'READY') { setProblem(explain(body.result?.state)); return; }
      // A beginner should not have to find a model menu next: the connected model becomes Aura's model at once.
      // The runtime only accepts it after the model has answered a short test question.
      const chosen = await fetch('/api/nova/planner', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: body.result.id, model: body.result.defaultModel }),
      }).then(r => r.json()).catch(() => ({ success: false }));
      if (!chosen?.success) { setProblem(tr('Nyckeln fungerar, men modellen svarade inte på testfrågan. Vänta en minut och tryck på Koppla in igen.', 'The key works, but the model did not answer the test question. Wait a minute and press Connect again.')); return; }
      setKey(''); setStep('done');
      window.dispatchEvent(new Event('jaco:aura:provider-chosen'));
      await onConnected();
    } catch { setProblem(explain('')); }
    finally { setBusy(false); }
  };

  const questions: Array<[string, string, string]> = [
    ['cost', tr('Kostar det pengar?', 'Does it cost money?'), tr('Nej. Google ger en gratis nivå som räcker för att prova och för vanligt bruk. Du behöver inget betalkort. Om du senare vill använda mer kan du själv välja det, och JACO har en budget du bestämmer.', 'No. Google has a free tier that is enough to try JACO and for everyday use. No payment card is needed. If you later want more, you choose that yourself, and JACO has a budget that you set.')],
    ['what', tr('Vad är en nyckel?', 'What is a key?'), tr('En nyckel är som ett personligt lösenord som låter JACO använda Googles AI åt dig. Den säger inget om dig och ger ingen åtkomst till ditt Google-konto eller dina filer.', 'A key is like a personal password that lets JACO use Google\'s AI for you. It reveals nothing about you and gives no access to your Google account or your files.')],
    ['safe', tr('Är det säkert?', 'Is it safe?'), tr('Nyckeln sparas krypterad på din egen dator och visas aldrig i chatten. Du kan när som helst ta bort den i Google AI Studio, då slutar den fungera direkt.', 'The key is stored encrypted on your own computer and never shown in the chat. You can delete it in Google AI Studio at any time, and it stops working immediately.')],
    ['files', tr('Vad skickas till Google?', 'What is sent to Google?'), tr('Det du ber Aura om och det Aura behöver för att svara, till exempel texten på en sida den läser. Vill du att inget lämnar datorn kan du i stället använda en lokal modell (Ollama).', 'What you ask Aura and what it needs to answer, for example the text of a page it reads. If you want nothing to leave your computer, you can use a local model (Ollama) instead.')],
  ];

  return (
    <section role="dialog" aria-label={tr('Kom igång med JACO', 'Get started with JACO')} data-testid="first-run-guide"
      className="m-4 rounded-xl border border-sky-800 bg-[#262729] p-5 text-neutral-200 shadow-lg max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{step === 'done' ? tr('Klart! Aura kan börja arbeta.', 'Done! Aura can start working.') : tr('Välkommen! Aura behöver en AI-hjärna först.', 'Welcome! Aura needs an AI brain first.')}</h2>
        <button type="button" onClick={onClose} aria-label={tr('Stäng', 'Close')} className="text-neutral-300 hover:text-neutral-200"><X size={16} /></button>
      </div>

      {step === 'intro' && <div className="mt-3 space-y-3 text-sm leading-relaxed">
        <p>{tr('JACO körs på din dator, men själva tänkandet görs av en AI-modell. Det enklaste är Googles modell Gemini. Den är gratis att börja med och tar ungefär två minuter att koppla in.', 'JACO runs on your computer, but the thinking is done by an AI model. The easiest is Google\'s model Gemini. It is free to start with and takes about two minutes to connect.')}</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>{tr('Öppna Google AI Studio och logga in med ditt Google-konto.', 'Open Google AI Studio and sign in with your Google account.')}</li>
          <li>{tr('Klicka på "Create API key" och kopiera nyckeln.', 'Click "Create API key" and copy the key.')}</li>
          <li>{tr('Klistra in den här. Klart.', 'Paste it here. Done.')}</li>
        </ol>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noreferrer" onClick={() => setStep('paste')}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500">
            <ExternalLink size={14} />{tr('Öppna Google AI Studio', 'Open Google AI Studio')}</a>
          <button type="button" onClick={() => setStep('paste')} className="rounded border border-neutral-600 px-3 py-2 hover:bg-neutral-700">{tr('Jag har redan en nyckel', 'I already have a key')}</button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-neutral-300"><ShieldCheck size={13} />{tr('Gratis, inget betalkort, och nyckeln stannar krypterad på din dator.', 'Free, no payment card, and the key stays encrypted on your computer.')}</p>
      </div>}

      {step === 'paste' && <div className="mt-3 space-y-3 text-sm">
        <p>{tr('Klistra in nyckeln du kopierade från Google AI Studio:', 'Paste the key you copied from Google AI Studio:')}</p>
        <div className="flex gap-2">
          <input type="password" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void connect(); }}
            aria-label={tr('Din nyckel från Google AI Studio', 'Your Google AI Studio key')} placeholder="AIza…" autoComplete="off"
            className="flex-1 rounded border border-neutral-600 bg-[#1d1e20] px-3 py-2 font-mono" />
          <button type="button" onClick={() => void connect()} disabled={busy || !key.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-2 font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}{busy ? tr('Kontrollerar…', 'Checking…') : tr('Koppla in', 'Connect')}</button>
        </div>
        {busy && <p className="text-xs text-neutral-300">{tr('JACO frågar Google om nyckeln fungerar. Det tar några sekunder.', 'JACO is asking Google whether the key works. It takes a few seconds.')}</p>}
        {problem && <p role="alert" className="text-amber-300">{problem}</p>}
        <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-300 underline"><ExternalLink size={12} />{tr('Öppna Google AI Studio igen', 'Open Google AI Studio again')}</a>
      </div>}

      {step === 'done' && <div className="mt-3 space-y-2 text-sm">
        <p className="flex items-center gap-1.5 text-emerald-300"><Check size={15} />{tr('Gemini är inkopplad och fungerar.', 'Gemini is connected and working.')}</p>
        <p>{tr('Skriv vad du vill ha hjälp med i rutan nedanför, till exempel: "Öppna jacocode.com och berätta vad sidan handlar om." Aura berättar vad den gör medan den arbetar.', 'Type what you want help with in the box below, for example: "Open jacocode.com and tell me what the page is about." Aura tells you what it is doing while it works.')}</p>
        <button type="button" onClick={onClose} className="rounded bg-sky-600 px-3 py-2 font-medium text-white">{tr('Börja', 'Start')}</button>
      </div>}

      {step !== 'done' && <div className="mt-4 border-t border-neutral-600 pt-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs text-neutral-300"><HelpCircle size={13} />{tr('Vanliga frågor', 'Common questions')}</p>
        {questions.map(([id, q, a]) => <div key={id} className="text-sm">
          <button type="button" onClick={() => setFaq(faq === id ? null : id)} aria-expanded={faq === id} className="w-full py-1 text-left text-sky-200 hover:underline">{q}</button>
          {faq === id && <p className="pb-2 text-neutral-200">{a}</p>}
        </div>)}
      </div>}
    </section>
  );
}

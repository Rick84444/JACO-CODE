// The status card in the work panel speaks the operator's language: one language at a time, plain words, no
// words such as "runtime", "executor" or "CDP". The model in lib/auraPresence.mjs keeps its exact English
// sentences (tests rely on them); this maps each of them to what the operator reads.
import type { AuraPresenceView } from '../components/AuraPresence';

type Words = [sv: string, en: string];
const W: Record<string, Words> = {
  // Titles
  'Connecting to JACO': ['Aura startar', 'Aura is starting'],
  'Runtime stopped': ['JACO är stoppat', 'JACO is stopped'],
  'Refreshing status': ['Uppdaterar läget', 'Refreshing status'],
  'Connection lost': ['Kontakten tappades', 'Connection lost'],
  'Your approval is needed': ['Aura behöver ditt ja', 'Aura needs your yes'],
  'The run is blocked': ['Arbetet har stannat', 'The work has stopped'],
  'The mission has stalled': ['Uppdraget har stannat', 'The mission has stalled'],
  'Registered, waiting to run': ['Registrerat, väntar på att starta', 'Registered, waiting to start'],
  'Agent connection observed': ['Aura är redo', 'Aura is ready'],
  'Aura is connected': ['Aura är redo', 'Aura is ready'],
  'Planning the next action': ['Planerar nästa steg', 'Planning the next step'],
  'Executing the mission': ['Utför uppdraget', 'Carrying out the mission'],
  'Verifying results': ['Kontrollerar resultatet', 'Checking the result'],
  'Waiting for the next step': ['Väntar på nästa steg', 'Waiting for the next step'],
  'Blocked': ['Stoppad', 'Stopped'],
  'Queued': ['I kö', 'Queued'],
  'Awaiting verification': ['Väntar på kontroll', 'Waiting to be checked'],
  'Mission registered': ['Uppdraget är registrerat', 'Mission registered'],
  // Details
  'Checking the runtime and the observed events.': ['Kontrollerar att allt är igång.', 'Checking that everything is running.'],
  "The server's latest state shows that execution is not running.": ['JACO körs inte just nu. Starta det igen så fortsätter Aura.', 'JACO is not running right now. Start it again and Aura continues.'],
  'JACO is reconnecting. Nothing is wrong with your work.': ['Kontakten uppdateras. Ditt arbete påverkas inte.', 'Reconnecting. Your work is not affected.'],
  'The event stream is not responding. The results last shown may be old.': ['Jag får inget svar just nu. Det du ser kan vara gammalt.', 'No answer right now. What you see may be out of date.'],
  'The workspace status report is too old or missing.': ['Läget har inte uppdaterats på ett tag.', 'The status has not updated for a while.'],
  'Waiting for a fresh event stream.': ['Väntar på ny kontakt.', 'Waiting for a new connection.'],
  'A registered mission is waiting for action.': ['Ett uppdrag väntar på dig eller på Aura.', 'A mission is waiting for you or for Aura.'],
  'The mission is marked active, but there is no fresh observed progress.': ['Uppdraget är aktivt men har inte kommit framåt på ett tag.', 'The mission is active but has made no progress for a while.'],
  'No tool step has started yet.': ['Inget steg har startat än.', 'No step has started yet.'],
  'A mission is active.': ['Ett uppdrag pågår.', 'A mission is in progress.'],
  'Agents are connected, but no active mission is confirmed in the mission list.': ['Inget uppdrag pågår just nu.', 'No mission is running right now.'],
  'No active mission reported. Ask Aura to show or create something.': ['Inget uppdrag pågår. Be Aura visa eller skapa något.', 'No mission is running. Ask Aura to show or create something.'],
  // Step, blocker, next action
  'No tool step reported yet': ['Inget steg rapporterat än', 'No step reported yet'],
  'A decision is waiting for you.': ['Ett beslut väntar på dig.', 'A decision is waiting for you.'],
  'The result is waiting for verification.': ['Resultatet väntar på kontroll.', 'The result is waiting to be checked.'],
  'The mission is blocked. The cause has not been reported.': ['Uppdraget har stannat och orsaken är inte rapporterad.', 'The mission has stopped and the cause has not been reported.'],
  'No new progress has been reported. The cause is not yet verified.': ['Inga nya framsteg. Orsaken är inte klarlagd.', 'No new progress. The cause is not yet known.'],
  'No tool step has started. The runtime has not reported why.': ['Inget steg har startat och orsaken är inte rapporterad.', 'No step has started and the cause has not been reported.'],
  'Waiting for the executor to take the mission.': ['Väntar på att uppdraget ska tas upp.', 'Waiting for the mission to be picked up.'],
  'No blocker reported.': ['Inget har stoppat arbetet.', 'Nothing is stopping the work.'],
  'Restore the connection before judging the mission status.': ['Återställ kontakten först.', 'Restore the connection first.'],
  'Open the decisions panel and review the waiting decision.': ['Öppna besluten och godkänn eller avslå.', 'Open the decisions and approve or decline.'],
  'Review the mission evidence and the reported cause before resuming.': ['Titta på bevisen och orsaken innan du fortsätter.', 'Look at the evidence and the cause before continuing.'],
  'Check the executor and the model. Do not start a copy of the mission.': ['Kontrollera modellen. Starta inte om uppdraget.', 'Check the model. Do not start the mission again.'],
  'Follow the next reported step. You can stop or steer the mission in the chat.': ['Följ nästa steg. Du kan stoppa eller styra uppdraget i chatten.', 'Follow the next step. You can stop or steer the mission in the chat.'],
  'Give Aura a mission.': ['Ge Aura ett uppdrag.', 'Give Aura a mission.'],
  // Labels
  'JACO connected': ['Ansluten', 'Connected'],
  'Reconnecting…': ['Ansluter igen…', 'Reconnecting…'],
  'No answer from JACO': ['Inget svar', 'No answer'],
  'CDP verified': ['Webbläsaren kontrollerad', 'Browser verified'],
  'CDP connected': ['Webbläsaren ansluten', 'Browser connected'],
  'CDP not observed': ['Webbläsaren inte ansluten', 'Browser not connected'],
  'Model not observed': ['Modell okänd', 'Model unknown'],
  'No mission': ['Inget uppdrag', 'No mission'],
};

export function humanPresence(data: AuraPresenceView, language: string): AuraPresenceView {
  const sv = language === 'sv';
  const t = (text: string | undefined) => (text && W[text] ? W[text][sv ? 0 : 1] : text) as string;
  return {
    ...data,
    title: t(data.title), detail: t(data.detail), blocker: t(data.blocker), nextAction: t(data.nextAction),
    connectionLabel: t(data.connectionLabel), cdpLabel: t(data.cdpLabel), modelLabel: t(data.modelLabel),
    phaseLabel: t(data.phaseLabel), step: t(data.step),
  };
}

export function presenceAge(seconds: number | null, language: string): string {
  const sv = language === 'sv';
  if (seconds === null) return sv ? 'Tid okänd' : 'Time unknown';
  if (seconds < 60) return sv ? `för ${seconds} s sedan` : `${seconds} s ago`;
  if (seconds < 3600) return sv ? `för ${Math.floor(seconds / 60)} min sedan` : `${Math.floor(seconds / 60)} min ago`;
  return sv ? `för ${Math.floor(seconds / 3600)} h sedan` : `${Math.floor(seconds / 3600)} h ago`;
}

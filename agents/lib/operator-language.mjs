// The language the operator chose in the GUI (EN / SV). The GUI saves it next to the planner choice, so the runtime, SEER
// and the executor read the same file. Aura's narration and answers follow it, not the language a goal happened to be
// written in (a Swedish operator with an English goal got English narration, 2026-11-06).
import fs from 'node:fs';
import path from 'node:path';
import { plannerChoiceFile } from './planner-choice.mjs';

export const LANGUAGE_NAMES = { en: 'English', sv: 'Swedish' };

export function operatorLanguageFile(env = process.env) {
  return path.join(path.dirname(plannerChoiceFile(env)), 'operator-language.json');
}

export function readOperatorLanguage(env = process.env, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(operatorLanguageFile(env), 'utf8'))?.language;
    return Object.hasOwn(LANGUAGE_NAMES, value) ? value : null;
  } catch { return null; }
}

export function writeOperatorLanguage(file, language, fsImpl = fs) {
  if (!Object.hasOwn(LANGUAGE_NAMES, language)) throw new Error('LANGUAGE_INVALID');
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, `${JSON.stringify({ language, at: new Date().toISOString() })}\n`);
  return { language };
}

/** One instruction line for the planner, or an empty string when the operator has not chosen. */
export function languageInstruction(language) {
  const name = LANGUAGE_NAMES[language];
  return name ? `Write every say and learned field and your final answer in ${name}, the language the operator chose in the interface, whatever language the goal or the pages are in.` : '';
}

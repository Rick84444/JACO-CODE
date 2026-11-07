// The operator asking Aura in the chat to change the spending limit ("höj budgeten till 15 dollar", "raise the
// monthly limit by 10"). Aura cannot change the limit herself; the chat answers with the change filled in, and the
// operator's own click saves it. Recognised in the GUI so it works even while the limit blocks every model call.
export type BudgetIntent = { field: 'daily' | 'monthly' | null; amount: number | null; relative: boolean };

// A word start that also works for å, ä and ö (\b does not).
const word = (alternatives: string) => new RegExp(`(?<!\\p{L})(?:${alternatives})`, 'iu');
// Inside compound words too: månadsgränsen, molnbudgeten.
const ABOUT = /budget|gräns|spending|limit|(?<!\p{L})cap(?!\p{L})/iu;
const MONEY = /usd|dollar|\$|kostnad|pengar|moln|cloud|cost|money|spend|utgift/iu;
const CHANGE = word('höj|öka|sänk|sätt|ändra|justera|raise|increase|lower|set(?!\\p{L})|change|adjust|bump');
const DAY = word('dag|daily|per day|a day|today|idag|i dag');
const MONTH = word('månad|monthly|per month|a month|month');
const RELATIVE = word('med|by|extra');

export function budgetIntent(text: string): BudgetIntent | null {
  const t = String(text || '');
  // "Budget" is enough; a bare "limit" must be about money ("sätt en gräns för antalet filer" is not this).
  const aboutMoney = /budget|spending/iu.test(t) || (ABOUT.test(t) && MONEY.test(t));
  if (t.length > 300 || !aboutMoney || !CHANGE.test(t)) return null;
  const field = DAY.test(t) ? 'daily' : MONTH.test(t) ? 'monthly' : null;
  const number = /(\d+(?:[.,]\d+)?)/.exec(t);
  const amount = number ? Number(number[1].replace(',', '.')) : null;
  // "höj med 5", "raise by 10": on top of the current limit.
  const relative = new RegExp(`${RELATIVE.source}\\s*\\$?\\s*\\d`, 'iu').test(t);
  return { field, amount: amount != null && Number.isFinite(amount) && amount >= 0 ? amount : null, relative };
}

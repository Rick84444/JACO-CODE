import React from 'react';

// Small Markdown renderer for chat replies: code fences, headings, lists, tables, bold and
// inline code. Builds React elements only (no innerHTML), so model output cannot inject markup.

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    out.push(token.startsWith('`')
      ? <code key={`${keyBase}-${i++}`} className="px-1 rounded bg-black/40 text-cyan-200 font-mono text-[11px]">{token.slice(1, -1)}</code>
      : <strong key={`${keyBase}-${i++}`} className="text-white font-semibold">{token.slice(2, -2)}</strong>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

export const ChatMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = String(text || '').split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={`c${i}`} className="my-1.5 p-2 rounded bg-black/50 border border-[#2b2b2b] overflow-x-auto font-mono text-[11px] text-slate-200">{code.join('\n')}</pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={`t${i}`} className="my-1.5 overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead><tr>{header.map((h, k) => <th key={k} className="border border-[#343434] px-2 py-1 text-left text-slate-300">{inline(h, `th${i}${k}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, rk) => <tr key={rk}>{r.map((c, k) => <td key={k} className="border border-[#2b2b2b] px-2 py-1 align-top">{inline(c, `td${i}${rk}${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(<div key={`h${i}`} className="mt-2 mb-1 font-semibold text-white">{inline(heading[2], `h${i}`)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      blocks.push(<ul key={`l${i}`} className="my-1 pl-4 list-disc space-y-0.5">{items.map((item, k) => <li key={k}>{inline(item, `li${i}${k}`)}</li>)}</ul>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    blocks.push(<p key={`p${i}`} className="my-1">{inline(line, `p${i}`)}</p>);
    i++;
  }
  return <>{blocks}</>;
};

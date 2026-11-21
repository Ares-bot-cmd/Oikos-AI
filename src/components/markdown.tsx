import { Fragment } from "react";

/**
 * Minimal, safe Markdown renderer for AI answers: paragraphs, bullet/numbered lists,
 * **bold**, `code` and pipe tables. Produces React elements only — never raw HTML.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = [];
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="border-b border-line">{head.map((h, j) => <th key={j} className="px-2 py-1 font-medium text-ink-2">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className="tnum px-2 py-1">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={key++} className={`my-1.5 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++].replace(/^#+\s*/, ""));
    blocks.push(<p key={key++} className="my-1.5">{inline(para.join(" "))}</p>);
  }
  return <div className="text-[13.5px] leading-relaxed text-ink">{blocks}</div>;
}

function inline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
      : p.startsWith("`") && p.endsWith("`") ? <code key={i} className="rounded bg-ink/[0.06] px-1 text-[12px]">{p.slice(1, -1)}</code>
        : <Fragment key={i}>{p}</Fragment>,
  );
}

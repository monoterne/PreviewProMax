export type SearchHit = {
  page: number;
  occurrence: number;
  start: number;
  end: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
};

export function findOccurrences(text: string, query: string, page: number): SearchHit[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // Literal matching keeps offsets in the original PDF text, including Unicode.
  const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const hits: SearchHit[] = [];
  for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
    const start = match.index;
    const end = start + match[0].length;
    const snippetStart = Math.max(0, start - 36);
    const snippetEnd = Math.min(text.length, end + 56);
    const before = `${snippetStart ? '…' : ''}${text.slice(snippetStart, start).replace(/\s+/g, ' ')}`;
    const matched = text.slice(start, end).replace(/\s+/g, ' ');
    const after = `${text.slice(end, snippetEnd).replace(/\s+/g, ' ')}${snippetEnd < text.length ? '…' : ''}`;
    hits.push({ page, occurrence: hits.length + 1, start, end,
      snippet: before + matched + after, matchStart: before.length, matchEnd: before.length + matched.length });
  }
  return hits;
}

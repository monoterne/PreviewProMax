export type SearchHit = {
  page: number;
  occurrence: number;
  start: number;
  end: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
};

export function makeSearchHit(text: string, page: number, occurrence: number, start: number, end: number): SearchHit {
  const snippetStart = Math.max(0, start - 36);
  const snippetEnd = Math.min(text.length, end + 56);
  const before = `${snippetStart ? '…' : ''}${text.slice(snippetStart, start).replace(/\s+/g, ' ')}`;
  const matched = text.slice(start, end).replace(/\s+/g, ' ');
  const after = `${text.slice(end, snippetEnd).replace(/\s+/g, ' ')}${snippetEnd < text.length ? '…' : ''}`;
  return { page, occurrence, start, end,
    snippet: before + matched + after, matchStart: before.length, matchEnd: before.length + matched.length };
}

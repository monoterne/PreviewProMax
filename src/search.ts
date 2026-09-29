export type SearchHit = { page: number; occurrence: number; snippet: string };

export function findOccurrences(text: string, query: string, page: number): SearchHit[] {
  const normalized = text.replace(/\s+/g, ' ');
  const haystack = normalized.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const hits: SearchHit[] = [];
  if (!needle) return hits;
  let from = 0;
  while (from < haystack.length) {
    const position = haystack.indexOf(needle, from);
    if (position === -1) break;
    const start = Math.max(0, position - 46);
    const end = Math.min(normalized.length, position + needle.length + 76);
    hits.push({
      page,
      occurrence: hits.length + 1,
      snippet: `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
    });
    from = position + needle.length;
  }
  return hits;
}

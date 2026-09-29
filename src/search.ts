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
  const needle = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!needle) return [];

  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length;) {
    const start = index;
    if (/\s/.test(text[index])) {
      while (index < text.length && /\s/.test(text[index])) index++;
      normalized += ' ';
    } else {
      normalized += text[index++];
    }
    starts.push(start);
    ends.push(index);
  }

  const haystack = normalized.toLocaleLowerCase();
  const hits: SearchHit[] = [];
  for (let from = 0; from < haystack.length;) {
    const position = haystack.indexOf(needle, from);
    if (position < 0) break;
    const snippetStart = Math.max(0, position - 36);
    const snippetEnd = Math.min(normalized.length, position + needle.length + 56);
    const prefix = snippetStart ? '…' : '';
    const snippet = `${prefix}${normalized.slice(snippetStart, snippetEnd)}${snippetEnd < normalized.length ? '…' : ''}`;
    const matchStart = prefix.length + position - snippetStart;
    hits.push({
      page,
      occurrence: hits.length + 1,
      start: starts[position],
      end: ends[position + needle.length - 1],
      snippet,
      matchStart,
      matchEnd: matchStart + needle.length
    });
    from = position + needle.length;
  }
  return hits;
}

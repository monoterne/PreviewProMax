import { expect, test } from 'bun:test';
import { findOccurrences } from '../src/search';

test('lists every occurrence on a page, ignoring case and repeated whitespace', () => {
  const hits = findOccurrences('Alpha   alpha\nALPHA and beta', 'alpha', 2);
  expect(hits.map(hit => [hit.page, hit.occurrence])).toEqual([[2, 1], [2, 2], [2, 3]]);
  expect(hits[2].snippet).toContain('ALPHA');
});

test('returns no occurrences for an empty query', () => {
  expect(findOccurrences('text', '', 1)).toEqual([]);
});

test('keeps source offsets for matches across PDF text chunks and line breaks', () => {
  const text = 'Before search\n  target and search target';
  const hits = findOccurrences(text, 'search target', 1);
  expect(hits.map(hit => text.slice(hit.start, hit.end))).toEqual(['search\n  target', 'search target']);
  expect(hits.map(hit => hit.snippet.slice(hit.matchStart, hit.matchEnd))).toEqual(['search target', 'search target']);
});

test('treats punctuation literally and keeps offsets after Unicode text', () => {
  const text = 'İ before (a+b) and (A+B)';
  expect(findOccurrences(text, '(a+b)', 1).map(hit => text.slice(hit.start, hit.end))).toEqual(['(a+b)', '(A+B)']);
});

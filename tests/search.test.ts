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

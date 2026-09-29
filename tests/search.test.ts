import { expect, test } from 'bun:test';
import { makeSearchHit } from '../src/search';

test('snippet offsets preserve the highlighted source after whitespace normalization', () => {
  const text = 'Before search\n  target after';
  const hit = makeSearchHit(text, 3, 2, 7, 22);
  expect(hit.snippet.slice(hit.matchStart, hit.matchEnd)).toBe('search target');
  expect([hit.page, hit.occurrence, hit.start, hit.end]).toEqual([3, 2, 7, 22]);
});

test('long snippets include ellipses without shifting the match', () => {
  const text = 'x'.repeat(80) + 'needle' + 'y'.repeat(90);
  const hit = makeSearchHit(text, 1, 1, 80, 86);
  expect(hit.snippet.startsWith('…')).toBe(true);
  expect(hit.snippet.endsWith('…')).toBe(true);
  expect(hit.snippet.slice(hit.matchStart, hit.matchEnd)).toBe('needle');
});

import { expect, test } from 'bun:test';
import { streamValues } from '../src/compatibility';

test('stream iteration yields chunks and releases its reader', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue('text'); controller.enqueue('more'); controller.close(); } });
  const chunks = [];
  for await (const chunk of streamValues.call(stream)) chunks.push(chunk);
  expect(chunks).toEqual(['text', 'more']);
  expect(stream.locked).toBe(false);
});

test('early exit cancels extraction and releases the reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue('text'); }, cancel() { cancelled = true; } });
  for await (const _chunk of streamValues.call(stream)) break;
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});

test('stream errors propagate instead of becoming empty text', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('failed extraction')); } });
  await expect(streamValues.call(stream).next()).rejects.toThrow('failed extraction');
  expect(stream.locked).toBe(false);
});

// PDF.js iterates text streams. macOS 15's WKWebView has ReadableStream,
// but lacks its async iterator even when other recent JavaScript APIs exist.
export async function* streamValues<T>(this: ReadableStream<T>, options: { preventCancel?: boolean } = {}) {
  const reader = this.getReader();
  let finished = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) { finished = true; return; }
      yield result.value;
    }
  } finally {
    try { if (!finished && !options.preventCancel) await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
}
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { configurable: true, writable: true, value: streamValues });
}

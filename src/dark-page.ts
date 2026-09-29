// PDF.js reports embedded image locations as normalized triples. Keep those
// pixels unchanged while applying the viewer's dark filter to the rest of a page.
export function darkenOutsideImages(canvas: HTMLCanvasElement, coordinates: ArrayLike<number> | null): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  const stripHeight = Math.min(128, height);
  const mask = coordinates?.length ? document.createElement('canvas') : null;
  if (mask) { mask.width = width; mask.height = stripHeight; }
  const maskContext = mask?.getContext('2d', { willReadFrequently: true });
  if (mask && !maskContext) return;

  try {
    for (let top = 0; top < height; top += stripHeight) {
      const rows = Math.min(stripHeight, height - top);
      let imageMask: Uint8ClampedArray | null = null;
      if (coordinates?.length && maskContext) {
        maskContext.clearRect(0, 0, width, stripHeight);
        maskContext.fillStyle = '#fff';
        for (let index = 0; index + 5 < coordinates.length; index += 6) {
          const x0 = coordinates[index] * width;
          const y0 = coordinates[index + 1] * height - top;
          const x1 = coordinates[index + 2] * width;
          const y1 = coordinates[index + 3] * height - top;
          const x2 = coordinates[index + 4] * width;
          const y2 = coordinates[index + 5] * height - top;
          maskContext.beginPath();
          maskContext.moveTo(x0, y0);
          maskContext.lineTo(x1, y1);
          maskContext.lineTo(x1 + x2 - x0, y1 + y2 - y0);
          maskContext.lineTo(x2, y2);
          maskContext.closePath();
          maskContext.fill();
        }
        imageMask = maskContext.getImageData(0, 0, width, rows).data;
      }
      const image = context.getImageData(0, top, width, rows);
      const pixels = image.data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (imageMask && imageMask[index + 3] > 0) continue;
        const red = 255 - pixels[index];
        const green = 255 - pixels[index + 1];
        const blue = 255 - pixels[index + 2];
        pixels[index] = finishColor(-0.574 * red + 1.43 * green + 0.144 * blue);
        pixels[index + 1] = finishColor(0.426 * red + 0.43 * green + 0.144 * blue);
        pixels[index + 2] = finishColor(0.426 * red + 1.43 * green - 0.856 * blue);
      }
      context.putImageData(image, 0, top);
    }
  } finally {
    if (mask) { mask.width = 0; mask.height = 0; }
  }
}

function finishColor(value: number): number {
  const rotated = Math.max(0, Math.min(255, value));
  return Math.max(0, Math.min(255, (rotated * 0.88 - 127.5) * 0.9 + 127.5));
}

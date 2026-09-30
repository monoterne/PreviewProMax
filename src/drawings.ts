export type DrawingTool = 'pencil' | 'rectangle' | 'circle' | 'eraser' | null;
export type ShapeKind = Exclude<DrawingTool, 'eraser' | null>;
export type Point = [number, number];
export type Drawing = {
  id: string;
  page: number;
  kind: ShapeKind;
  points: Point[];
  rotation: number;
  color: string;
  width: number;
};

const svgNamespace = 'http://www.w3.org/2000/svg';
const colors = new Set(['#e24b46', '#2672d9', '#23834b', '#252525', '#ffffff']);
export function validDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Drawing>;
  return typeof item.id === 'string' && Number.isInteger(item.page) &&
    ['pencil', 'rectangle', 'circle'].includes(item.kind || '') &&
    [0, 90, 180, 270].includes(item.rotation ?? -1) &&
    typeof item.color === 'string' && colors.has(item.color) &&
    typeof item.width === 'number' && item.width >= 1 && item.width <= 12 &&
    Array.isArray(item.points) && item.points.length >= 1 && item.points.length <= 10000 &&
    item.points.every(point => Array.isArray(point) && point.length === 2 &&
      point.every(coordinate => typeof coordinate === 'number' && coordinate >= 0 && coordinate <= 1));
}

export function pointOnPage(event: PointerEvent, layer: SVGSVGElement): Point {
  const bounds = layer.getBoundingClientRect();
  return [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];
}

export function circleEnd(start: Point, end: Point, layer: SVGSVGElement): Point {
  const bounds = layer.getBoundingClientRect();
  const distance = Math.min(Math.abs(end[0] - start[0]) * bounds.width, Math.abs(end[1] - start[1]) * bounds.height);
  return [start[0] + Math.sign(end[0] - start[0]) * distance / bounds.width,
    start[1] + Math.sign(end[1] - start[1]) * distance / bounds.height];
}

function rotated(point: Point, from: number, to: number): Point {
  const turns = ((to - from + 360) % 360) / 90;
  let [x, y] = point;
  for (let i = 0; i < turns; i++) [x, y] = [1 - y, x];
  return [x * 1000, y * 1000];
}

function shapeElement(drawing: Drawing, rotation: number, hit: boolean): SVGElement {
  const points = drawing.points.map(point => rotated(point, drawing.rotation, rotation));
  let shape: SVGElement;
  if (drawing.kind === 'pencil') {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', points.length === 1
      ? `M ${points[0][0]} ${points[0][1]} l 0.01 0`
      : points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' '));
    shape = path;
  } else {
    const [start, end = start] = points;
    const x = Math.min(start[0], end[0]), y = Math.min(start[1], end[1]);
    const width = Math.abs(end[0] - start[0]), height = Math.abs(end[1] - start[1]);
    if (drawing.kind === 'rectangle') {
      const rect = document.createElementNS(svgNamespace, 'rect');
      rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
      shape = rect;
    } else {
      const ellipse = document.createElementNS(svgNamespace, 'ellipse');
      ellipse.setAttribute('cx', String(x + width / 2)); ellipse.setAttribute('cy', String(y + height / 2));
      ellipse.setAttribute('rx', String(width / 2)); ellipse.setAttribute('ry', String(height / 2));
      shape = ellipse;
    }
  }
  shape.setAttribute('fill', hit && drawing.kind !== 'pencil' ? 'transparent' : 'none');
  shape.setAttribute('stroke', hit ? 'transparent' : drawing.color);
  shape.setAttribute('stroke-width', String(hit ? Math.max(14, drawing.width + 10) : drawing.width));
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  shape.setAttribute('vector-effect', 'non-scaling-stroke');
  if (hit) shape.classList.add('drawing-hit');
  return shape;
}

export function updateDrawing(group: SVGGElement, drawing: Drawing, rotation: number) {
  group.replaceChildren(shapeElement(drawing, rotation, false));
  if (!group.classList.contains('drawing-preview')) group.appendChild(shapeElement(drawing, rotation, true));
}

export function paintDrawings(shell: HTMLElement, drawings: Drawing[], rotation: number, tool: DrawingTool): SVGSVGElement | null {
  const content = shell.querySelector<HTMLElement>('.page-content');
  if (!content) return null;
  const visible = drawings.filter(drawing => drawing.page === Number(shell.dataset.page));
  let layer = content.querySelector<SVGSVGElement>('.drawing-layer');
  if (!visible.length && !tool && !layer) return null;
  if (!layer) {
    layer = document.createElementNS(svgNamespace, 'svg');
    layer.classList.add('drawing-layer');
    layer.setAttribute('viewBox', '0 0 1000 1000');
    layer.setAttribute('preserveAspectRatio', 'none');
    layer.setAttribute('aria-label', `Drawings on page ${shell.dataset.page}`);
    content.appendChild(layer);
  }
  layer.classList.toggle('drawing-active', !!tool);
  layer.classList.toggle('drawing-eraser', tool === 'eraser');
  const fragment = document.createDocumentFragment();
  for (const drawing of visible) {
    const group = document.createElementNS(svgNamespace, 'g');
    group.dataset.drawingId = drawing.id;
    updateDrawing(group, drawing, rotation);
    fragment.appendChild(group);
  }
  layer.replaceChildren(fragment);
  return layer;
}

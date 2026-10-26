import test from 'node:test';
import assert from 'node:assert/strict';
import { deformCheek, type CheekDeformationOptions } from '../src/cheek.ts';

const width = 941, height = 1672, cols = 33, rows = 43;
function grid(w = width, h = height) {
  const result = new Float32Array(cols * rows * 2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 2; result[i] = x * w / (cols - 1); result[i + 1] = y * h / (rows - 1);
  }
  return result;
}
const base = grid();
const options: CheekDeformationOptions = { textureWidth: width, textureHeight: height, stageWidth: width, stageHeight: height, side: 'right', anchorX: 737, anchorY: 871, dx: 150, dy: 0, verticesX: cols, verticesY: rows };
function areas(values: Float32Array) {
  const result: number[] = [];
  const area = (a: number, b: number, c: number) => (values[b * 2] - values[a * 2]) * (values[c * 2 + 1] - values[a * 2 + 1]) - (values[b * 2 + 1] - values[a * 2 + 1]) * (values[c * 2] - values[a * 2]);
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols - 1; x++) {
    const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1; result.push(area(a, b, c), area(b, d, c));
  }
  return result;
}

test('both cheeks retain positive, readable fur triangles at all extreme drag directions and touch anchors', () => {
  const initialAreas = areas(base), output = new Float32Array(base.length);
  for (const side of ['left', 'right'] as const) for (const x of side === 'left' ? [40, 125, 280] : [540, 737, 820]) for (const y of [760, 871, 1100]) {
    for (const dx of [-0.16 * width, 0, 0.16 * width]) for (const dy of [-0.06 * height, 0, 0.06 * height]) {
      const contact = deformCheek(base, output, { ...options, side, anchorX: x, anchorY: y, dx, dy });
      assert.ok(contact.strength >= 0 && contact.strength <= 1);
      const current = areas(output);
      for (let i = 0; i < current.length; i++) {
        assert.ok(current[i] >= initialAreas[i] * 0.219, `fold/compression: ${side} anchor ${x},${y} drag ${dx},${dy} triangle ${i}`);
        assert.ok(current[i] <= initialAreas[i] * 2.801, 'fur must not stretch into a thin triangle');
      }
    }
  }
});

test('eyes, nose, ears, opposite cheek and front paws remain exactly fixed', () => {
  for (const side of ['left', 'right'] as const) {
    const output = new Float32Array(base.length);
    deformCheek(base, output, { ...options, side, anchorX: side === 'right' ? 737 : 125, dx: side === 'right' ? 150 : -150, dy: 90 });
    for (let i = 0; i < base.length; i += 2) {
      const x = base[i], y = base[i + 1];
      if (y <= 700 || y >= 1350 || (side === 'right' ? x <= width * 0.43 : x >= width * 0.38)) {
        assert.equal(output[i], x); assert.equal(output[i + 1], y);
      }
    }
  }
});

test('inward dragging seals cropped stage edges rather than exposing a hard background polygon', () => {
  for (const [side, dx, col] of [['left', 150, 0], ['right', -150, cols - 1]] as const) {
    const output = new Float32Array(base.length);
    deformCheek(base, output, { ...options, side, anchorX: side === 'left' ? 125 : 737, dx, dy: 90 });
    for (let row = 0; row < rows; row++) {
      const i = (row * cols + col) * 2;
      assert.equal(output[i], base[i]); assert.equal(output[i + 1], base[i + 1]);
    }
  }
});

test('contact follows the actual triangle surface and resistance rather than the unbounded pointer', () => {
  for (const input of [{ ...options }, { ...options, side: 'left' as const, anchorX: 125, anchorY: 900, dx: 150, dy: -100 }]) {
    const output = new Float32Array(base.length);
    const contact = deformCheek(base, output, input);
    assert.ok(Math.abs(contact.contactX - (input.anchorX + input.dx * contact.strength)) < 0.001);
    assert.ok(Math.abs(contact.contactY - (input.anchorY + input.dy * contact.strength)) < 0.001);
    assert.ok(Math.abs(contact.contactX - input.anchorX) <= Math.abs(input.dx));
  }
});

test('a changed or released drag always rebuilds from the immutable master without accumulated distortion', () => {
  const before = new Float32Array(base), output = new Float32Array(base.length);
  deformCheek(base, output, options); const once = new Float32Array(output);
  deformCheek(base, output, { ...options, dx: -150, dy: 90 });
  deformCheek(base, output, options); assert.deepEqual(output, once);
  deformCheek(base, output, { ...options, dx: 0, dy: 0 });
  assert.deepEqual(output, before); assert.deepEqual(base, before);
});

test('the same logical gesture and contact remain consistent with a higher resolution texture', () => {
  const output = new Float32Array(base.length), highBase = grid(width * 2, height * 2), highOutput = new Float32Array(base.length);
  const low = deformCheek(base, output, { ...options, dy: 70 });
  const high = deformCheek(highBase, highOutput, { ...options, textureWidth: width * 2, textureHeight: height * 2, dy: 70 });
  assert.ok(Math.abs(high.contactX - low.contactX) < 0.001); assert.ok(Math.abs(high.contactY - low.contactY) < 0.001);
  for (let i = 0; i < output.length; i++) assert.equal(highOutput[i], output[i] * 2);
});

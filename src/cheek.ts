/** Local fur deformation in source texture coordinates; all pointer values are logical stage pixels. */
export interface CheekDeformationOptions {
  textureWidth: number;
  textureHeight: number;
  stageWidth: number;
  stageHeight: number;
  side: 'left' | 'right';
  anchorX: number;
  anchorY: number;
  dx: number;
  dy: number;
  verticesX: number;
  verticesY: number;
}

export interface CheekContact {
  /** Contact sampled from the actual rendered triangles, in logical stage pixels. */
  contactX: number;
  contactY: number;
  /** Soft resistance applied to the requested displacement to retain a valid fur mesh. */
  strength: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (lo: number, hi: number, value: number) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const workspaces = new WeakMap<Float32Array, { x: Float64Array; y: Float64Array }>();

/** First positive zero of a quadratic; the deformation may only approach this zero from below. */
function positiveRoot(a: number, b: number, c: number): number {
  if (Math.abs(a) <= 1e-12 * (Math.abs(b) + Math.abs(c) + 1)) {
    return b < 0 ? -c / b : Infinity;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Infinity;
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
  const r1 = q / a;
  const r2 = q === 0 ? Infinity : c / q;
  return Math.min(r1 > 1e-12 ? r1 : Infinity, r2 > 1e-12 ? r2 : Infinity);
}

/**
 * Rebuild a single cheek from an immutable UV master. The upper face, opposite cheek,
 * chest and paws remain fixed. Inward motion cannot pull a cropped edge away from
 * the stage. Independent horizontal/vertical edge weights also avoid a discontinuity
 * when a vertical gesture crosses dx=0.
 *
 * Triangle areas are quadratic in displacement strength. Their first compression or
 * expansion limit supplies continuous, soft resistance before a triangle can invert.
 */
export function deformCheek(
  base: Float32Array,
  output: Float32Array,
  options: CheekDeformationOptions,
): CheekContact {
  const { textureWidth: tw, textureHeight: th, stageWidth: sw, stageHeight: sh, verticesX: cols, verticesY: rows } = options;
  if (base === output) throw new Error('The cheek master must remain immutable');
  if (cols < 2 || rows < 2 || base.length !== cols * rows * 2 || output.length !== base.length || tw <= 0 || th <= 0 || sw <= 0 || sh <= 0) {
    throw new Error('Invalid cheek grid');
  }
  const anchorX = clamp(options.anchorX, 0, sw), anchorY = clamp(options.anchorY, 0, sh);
  const stageDX = clamp(Number.isFinite(options.dx) ? options.dx : 0, -0.16 * sw, 0.16 * sw);
  const stageDY = clamp(Number.isFinite(options.dy) ? options.dy : 0, -0.06 * sh, 0.06 * sh);
  output.set(base);
  if (stageDX === 0 && stageDY === 0) return { contactX: anchorX, contactY: anchorY, strength: 1 };
  const dx = stageDX * tw / sw, dy = stageDY * th / sh;
  let weights = workspaces.get(base);
  if (!weights) { weights = { x: new Float64Array(base.length / 2), y: new Float64Array(base.length / 2) }; workspaces.set(base, weights); }
  const wx = weights.x, wy = weights.y;

  // MeshPlane uses triangles [top-left, top-right, bottom-left] and [top-right, bottom-right, bottom-left].
  const gx = anchorX / sw * (cols - 1), gy = anchorY / sh * (rows - 1);
  const col = Math.min(cols - 2, Math.floor(gx)), row = Math.min(rows - 2, Math.floor(gy));
  const u = gx - col, v = gy - row, topLeft = row * cols + col;
  const indices = u + v <= 1 ? [topLeft, topLeft + 1, topLeft + cols] : [topLeft + 1, topLeft + cols + 1, topLeft + cols];
  const factors = u + v <= 1 ? [1 - u - v, u, v] : [1 - v, u + v - 1, 1 - u];
  const sampleWeight = (values: Float64Array) => indices.reduce((value, index, i) => value + values[index] * factors[i], 0);

  for (let point = 0; point < wx.length; point++) {
    const nx = base[point * 2] / tw, ny = base[point * 2 + 1] / th;
    const x = nx * sw, y = ny * sh;
    const side = options.side === 'right' ? smooth(0.43, 0.68, nx) : 1 - smooth(0.20, 0.38, nx);
    const band = smooth(0.43, 0.50, ny) * (1 - smooth(0.67, 0.79, ny));
    const radial = Math.exp(-1.4 * (((x - anchorX) / (0.30 * sw)) ** 2 + ((y - anchorY) / (0.18 * sh)) ** 2));
    const influence = side * band * radial;
    // Outward motion can leave the cropped image, while inward motion keeps that edge sealed.
    const horizontalEdge = stageDX > 0 ? smooth(0, 0.14, nx) : 1 - smooth(0.86, 1, nx);
    const verticalEdge = smooth(0, 0.08, nx) * (1 - smooth(0.92, 1, nx));
    wx[point] = influence * horizontalEdge;
    wy[point] = influence * verticalEdge;
  }
  const normX = sampleWeight(wx), normY = sampleWeight(wy);
  for (let point = 0; point < wx.length; point++) {
    wx[point] = normX > 1e-7 ? wx[point] / normX : 0;
    wy[point] = normY > 1e-7 ? wy[point] / normY : 0;
  }

  let limit = Infinity;
  const constrainTriangle = (a: number, b: number, c: number) => {
    const abx = base[b * 2] - base[a * 2], aby = base[b * 2 + 1] - base[a * 2 + 1];
    const acx = base[c * 2] - base[a * 2], acy = base[c * 2 + 1] - base[a * 2 + 1];
    const dabx = (wx[b] - wx[a]) * dx, daby = (wy[b] - wy[a]) * dy;
    const dacx = (wx[c] - wx[a]) * dx, dacy = (wy[c] - wy[a]) * dy;
    const signedArea = abx * acy - aby * acx, sign = Math.sign(signedArea), area = Math.abs(signedArea);
    const linear = sign * (dabx * acy + abx * dacy - daby * acx - aby * dacx);
    const quadratic = sign * (dabx * dacy - daby * dacx);
    // Keep at least 22% of the original area and no more than 2.8x, retaining readable fur.
    limit = Math.min(limit, positiveRoot(quadratic, linear, area * 0.78), positiveRoot(-quadratic, -linear, area * 1.8));
  };
  for (let row = 0; row < rows - 1; row++) for (let col = 0; col < cols - 1; col++) {
    const a = row * cols + col, b = a + 1, c = a + cols, d = c + 1;
    constrainTriangle(a, b, c); constrainTriangle(b, d, c);
  }
  const strength = Number.isFinite(limit) ? 1 / Math.pow(1 + Math.pow(1 / limit, 8), 1 / 8) : 1;
  for (let point = 0; point < wx.length; point++) {
    output[point * 2] = base[point * 2] + wx[point] * dx * strength;
    output[point * 2 + 1] = base[point * 2 + 1] + wy[point] * dy * strength;
  }
  let contactX = 0, contactY = 0;
  for (let i = 0; i < 3; i++) { contactX += output[indices[i] * 2] * factors[i]; contactY += output[indices[i] * 2 + 1] * factors[i]; }
  return { contactX: contactX * sw / tw, contactY: contactY * sh / th, strength };
}

/**
 * Draws the app icon — a d20 — and writes every size the platforms ask for.
 *
 * The die is real geometry, not a traced polygon: a true icosahedron rotated
 * face-on and projected, so the facets meet where they actually would. Getting
 * that wrong is the difference between "a dice app" and "a vaguely gem-shaped
 * blob", and it shows most at the small sizes where the icon actually lives.
 *
 *   node scripts/make-icons.mjs
 *
 * Re-run after changing anything here; the PNGs are committed because a build
 * should not need a rasteriser.
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

/* ---------------------------------------------------------------- geometry */

const PHI = (1 + Math.sqrt(5)) / 2;

/** The 12 vertices of an icosahedron, as three orthogonal golden rectangles. */
function vertices() {
  const v = [];
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      v.push([0, a, b * PHI]);
      v.push([a, b * PHI, 0]);
      v.push([a * PHI, 0, b]);
    }
  }
  return v;
}

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p, q) => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const len = (p) => Math.hypot(p[0], p[1], p[2]);
const norm = (p) => {
  const l = len(p);
  return [p[0] / l, p[1] / l, p[2] / l];
};
const dist2 = (p, q) => dot(sub(p, q), sub(p, q));

/** Every triple whose three edges are all the shortest edge: the 20 faces. */
function faces(v) {
  const EDGE = 4; // squared, for this construction
  const out = [];
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      if (Math.abs(dist2(v[i], v[j]) - EDGE) > 1e-6) continue;
      for (let k = j + 1; k < v.length; k++) {
        if (Math.abs(dist2(v[i], v[k]) - EDGE) > 1e-6) continue;
        if (Math.abs(dist2(v[j], v[k]) - EDGE) > 1e-6) continue;
        out.push([i, j, k]);
      }
    }
  }
  return out;
}

/** Outward normal of a face, which for a convex solid centred on the origin
 *  is just the winding that points away from the middle. */
function faceNormal(v, f) {
  const n = norm(cross(sub(v[f[1]], v[f[0]]), sub(v[f[2]], v[f[0]])));
  const centroid = [0, 1, 2].map((i) => (v[f[0]][i] + v[f[1]][i] + v[f[2]][i]) / 3);
  return dot(n, centroid) < 0 ? n.map((x) => -x) : n;
}

/** Rodrigues rotation of p by `angle` about unit `axis`. */
function rotate(p, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, p);
  const d = dot(axis, p);
  return [0, 1, 2].map((i) => p[i] * c + k[i] * s + axis[i] * d * (1 - c));
}

/**
 * Turns the solid to face the viewer squarely.
 *
 * One face is brought flat to the screen and one of its corners taken to the
 * top, which lands the die as a symmetrical hexagon with an upright triangle in
 * the middle — the shape everyone already reads as "d20", and the only
 * orientation where the numeral sits level.
 */
function orient() {
  const v = vertices();
  const f = faces(v);

  const front = f[0];
  const n = faceNormal(v, front);

  // Bring that face's normal onto +z.
  const axis = cross(n, [0, 0, 1]);
  const turned =
    len(axis) < 1e-9
      ? v.map((p) => [...p])
      : v.map((p) => rotate(p, norm(axis), Math.acos(Math.min(1, dot(n, [0, 0, 1])))));

  // Spin about z until a corner of the front face points straight up.
  const a = turned[front[0]];
  const spin = Math.PI / 2 - Math.atan2(a[1], a[0]);
  const placed = turned.map((p) => rotate(p, [0, 0, 1], spin));

  return { v: placed, f };
}

/* ----------------------------------------------------------------- drawing */

const INK = { r: 255, g: 255, b: 255 }; // the die
const SHADE = { r: 176, g: 190, b: 240 }; // where a facet turns away: indigo, not grey
const LIGHT = norm([-0.35, 0.62, 0.70]); // upper-left, slightly toward the viewer

function facetFill(n) {
  // Lambert, lifted and compressed: facets should separate, not go muddy.
  const t = Math.max(0, dot(n, LIGHT));
  const k = 0.55 + 0.45 * t;
  const mix = (a, b) => Math.round(b + (a - b) * k);
  return `rgb(${mix(INK.r, SHADE.r)},${mix(INK.g, SHADE.g)},${mix(INK.b, SHADE.b)})`;
}

/**
 * @param {number} size      pixel square
 * @param {object} opts
 * @param {number} opts.pad     fraction of the canvas left empty around the die
 * @param {number} opts.radius  corner radius as a fraction of size (0 = square)
 * @param {boolean} opts.numeral draw the 20
 */
function svg(size, { pad, radius, numeral }) {
  const { v, f } = orient();

  const visible = f
    .map((face) => ({ face, n: faceNormal(v, face) }))
    .filter(({ n }) => n[2] > 1e-6);

  // Scale so the hexagonal silhouette fills the space left by the padding.
  const reach = Math.max(...v.map((p) => Math.hypot(p[0], p[1])));
  const half = size / 2;
  const scale = (half * (1 - pad)) / reach;
  const px = (p) => [half + p[0] * scale, half - p[1] * scale]; // SVG y runs down

  const facets = visible
    .map(({ face, n }) => {
      const pts = face.map((i) => px(v[i]).map((x) => x.toFixed(2)).join(",")).join(" ");
      return `<polygon points="${pts}" fill="${facetFill(n)}"/>`;
    })
    .join("");

  // The face pointing at the viewer carries the number.
  const front = visible.find(({ n }) => n[2] > 0.999);
  const edge = Math.max(1, size * 0.006);

  let mark = "";
  if (numeral && front) {
    const corners = front.face.map((i) => px(v[i]));
    const cx = corners.reduce((s, p) => s + p[0], 0) / 3;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 3;
    const side = Math.hypot(corners[0][0] - corners[1][0], corners[0][1] - corners[1][1]);
    mark =
      `<text x="${cx.toFixed(2)}" y="${(cy + side * 0.055).toFixed(2)}" ` +
      `font-family="Liberation Sans, DejaVu Sans, sans-serif" font-weight="bold" ` +
      `font-size="${(side * 0.46).toFixed(2)}" fill="#2c3ea8" ` +
      `text-anchor="middle" dominant-baseline="central" ` +
      `letter-spacing="${(-side * 0.012).toFixed(2)}">20</text>`;
  }

  const bg =
    radius > 0
      ? `<rect width="${size}" height="${size}" rx="${(size * radius).toFixed(2)}" fill="url(#g)"/>`
      : `<rect width="${size}" height="${size}" fill="url(#g)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#5b73ec"/>
      <stop offset="1" stop-color="#2b3aa0"/>
    </linearGradient>
  </defs>
  ${bg}
  <g stroke="#33429c" stroke-width="${edge.toFixed(2)}" stroke-linejoin="round">${facets}</g>
  ${mark}
</svg>`;
}

/* ------------------------------------------------------------------ output */

/** Minimal ICO wrapper. Modern browsers read PNG payloads inside .ico. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const dir = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dir.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...dir, ...images.map((i) => i.data)]);
}

const png = (size, opts) => sharp(Buffer.from(svg(size, opts))).png().toBuffer();

async function main() {
  // Rounded, because these sit unmasked in app lists and desktop PWAs.
  const rounded = { pad: 0.13, radius: 0.22, numeral: true };
  // Android masks this to whatever shape the launcher likes: keep the die well
  // inside the safe circle and let the background run to the edge.
  const maskable = { pad: 0.29, radius: 0, numeral: true };
  // iOS applies its own squircle. Pre-rounding it would show dark corners.
  const apple = { pad: 0.13, radius: 0, numeral: true };
  // At favicon sizes the numeral is a smudge, so the silhouette carries it.
  const tiny = { pad: 0.06, radius: 0.18, numeral: false };

  const written = [];
  const write = async (path, size, opts) => {
    writeFileSync(path, await png(size, opts));
    written.push(`${path} (${size}px)`);
  };

  await write("public/icon-192.png", 192, rounded);
  await write("public/icon-512.png", 512, rounded);
  await write("public/icon-maskable-192.png", 192, maskable);
  await write("public/icon-maskable-512.png", 512, maskable);
  await write("src/app/apple-icon.png", 180, apple);
  await write("src/app/icon.png", 96, rounded);

  const sizes = [16, 32, 48];
  const layers = await Promise.all(
    sizes.map(async (size) => ({ size, data: await png(size, tiny) })),
  );
  writeFileSync("src/app/favicon.ico", ico(layers));
  written.push(`src/app/favicon.ico (${sizes.join(", ")}px)`);

  for (const line of written) console.log(`  ${line}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

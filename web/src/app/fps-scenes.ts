/**
 * The frame-rate demo's scenes, drawn in code. Each is a pure function of time, so every panel shows exactly
 * the same moment and only the number of frames differs. Original artwork in familiar settings (no game
 * footage, characters or signage), chosen for motion that shows frame rate well: things rushing past the
 * camera, sweeping lights, panning, and fast particles.
 */
export interface Scene {
  name: string;
  draw(g: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

type Ctx = CanvasRenderingContext2D;

/** Deterministic 0..1 noise. */
const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function vertical(g: Ctx, y0: number, y1: number, stops: string[]) {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  return grad;
}

function glow(g: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

/** Repeats `paint` every `gap` pixels across the width, scrolled left by `offset`. */
function strip(w: number, offset: number, gap: number, paint: (x: number, i: number) => void) {
  const first = Math.floor(offset / gap) - 1;
  for (let i = first; i * gap - offset < w + gap; i++) paint(i * gap - offset, i);
}

/** A forward-facing camera: world x (metres right), height y and distance z, to screen pixels. */
function camera(w: number, h: number, horizon: number, height: number) {
  const f = w * 0.9;
  const cx = w / 2;
  const y0 = h * horizon;
  return {
    x: (x: number, z: number) => cx + (x * f) / z,
    y: (y: number, z: number) => y0 + ((height - y) * f) / z,
    s: (size: number, z: number) => (size * f) / z,
    y0,
  };
}
type Camera = ReturnType<typeof camera>;

/** Distances of objects spaced `period` metres apart as the camera moves `travelled` metres. */
function ahead(travelled: number, period: number, near: number, far: number) {
  const out: number[] = [];
  for (let z = period - (travelled % period); z < far; z += period) if (z > near) out.push(z);
  return out;
}

function quad(g: Ctx, pts: number[], fill: string) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
}

/** A strip on the road surface between distances z1 and z2, centred on x. */
function roadMark(g: Ctx, c: Camera, x: number, half: number, z1: number, z2: number, fill: string) {
  quad(g, [c.x(x - half, z1), c.y(0, z1), c.x(x + half, z1), c.y(0, z1), c.x(x + half, z2), c.y(0, z2), c.x(x - half, z2), c.y(0, z2)], fill);
}

// ---- 1. Highway at midday: a forward view with lane lines, lamp posts and a sign gantry rushing past ----------

function highway(g: Ctx, w: number, h: number, t: number) {
  const c = camera(w, h, 0.46, 1.3);
  const run = t * 30;
  g.fillStyle = vertical(g, 0, c.y0, ['#4d9ee0', '#cfe7f6']);
  g.fillRect(0, 0, w, c.y0);

  // A plane crossing the sky, trailing a contrail.
  const px = ((t * 0.09) % 1.3 - 0.15) * w;
  const py = h * 0.13;
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = Math.max(1, h * 0.006);
  g.beginPath();
  g.moveTo(px - w * 0.3, py + h * 0.01);
  g.lineTo(px, py);
  g.stroke();
  g.fillStyle = '#e9eef2';
  g.beginPath();
  g.ellipse(px, py, w * 0.022, h * 0.006, -0.03, 0, Math.PI * 2);
  g.fill();
  quad(g, [px - w * 0.004, py, px + w * 0.006, py, px - w * 0.006, py + h * 0.02], '#c9d3db');

  // Skyline on the horizon.
  for (let i = 0; i < 18; i++) {
    const bx = (i / 18) * w * 1.1 - w * 0.05 - t * w * 0.003;
    const bw = w * (0.03 + rand(i) * 0.03);
    const bh = h * (0.08 + rand(i + 40) * 0.2);
    g.fillStyle = i % 3 ? '#9cbcd0' : '#86a9bf';
    g.fillRect(bx, c.y0 - bh, bw, bh);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 1; k < bh / (h * 0.02); k++) g.fillRect(bx + bw * 0.15, c.y0 - bh + k * h * 0.02, bw * 0.7, h * 0.004);
  }

  g.fillStyle = '#7f8f6e';
  g.fillRect(0, c.y0, w, h - c.y0);
  quad(g, [c.x(-9, 1), c.y(0, 1), c.x(9, 1), c.y(0, 1), c.x(9, 400), c.y(0, 400), c.x(-9, 400), c.y(0, 400)], '#5b5e64');
  for (const x of [-7.6, 7.6]) roadMark(g, c, x, 0.12, 1, 400, '#f2f2f2');
  for (const x of [-2.6, 2.6]) for (const z of ahead(run, 12, 0.8, 200)) roadMark(g, c, x, 0.1, z, z + 3.5, '#f2f2f2');

  // Everything standing up, drawn far to near.
  const things: { z: number; paint: () => void }[] = [];
  for (const z of ahead(run, 28, 1.2, 260)) {
    for (const side of [-1, 1]) {
      things.push({ z, paint: () => {
        const x = side * 10.5;
        const pw = Math.max(1, c.s(0.25, z));
        g.fillStyle = '#6d7277';
        g.fillRect(c.x(x, z) - pw / 2, c.y(9, z), pw, c.y(0, z) - c.y(9, z));
        g.fillRect(Math.min(c.x(x, z), c.x(x - side * 2.5, z)), c.y(9, z), Math.abs(c.x(x - side * 2.5, z) - c.x(x, z)), pw);
      } });
    }
  }
  const gantry = 150 - (run % 150) + 8;
  things.push({ z: gantry, paint: () => {
    const z = gantry;
    const pw = Math.max(1, c.s(0.4, z));
    g.fillStyle = '#7a7f86';
    for (const x of [-9.5, 9.5]) g.fillRect(c.x(x, z) - pw / 2, c.y(9.5, z), pw, c.y(0, z) - c.y(9.5, z));
    g.fillRect(c.x(-9.5, z), c.y(9.5, z), c.x(9.5, z) - c.x(-9.5, z), pw);
    for (const [a, b] of [[-7, -1.2], [1.2, 7]]) {
      const x1 = c.x(a, z), x2 = c.x(b, z), y1 = c.y(9.3, z), y2 = c.y(6.6, z);
      g.fillStyle = '#1f7a45';
      g.fillRect(x1, y1, x2 - x1, y2 - y1);
      g.strokeStyle = '#f4f4f4';
      g.lineWidth = Math.max(1, c.s(0.08, z));
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      g.fillStyle = '#f4f4f4';
      for (let k = 0; k < 2; k++) g.fillRect(x1 + (x2 - x1) * 0.15, y1 + (y2 - y1) * (0.3 + k * 0.3), (x2 - x1) * (0.7 - k * 0.25), Math.max(1, (y2 - y1) * 0.1));
    }
  } });
  const cars = [['#c0392b', -5.1], ['#ecf0f1', 0], ['#2c3e50', 5.1], ['#d68910', -5.1]] as const;
  cars.forEach(([color, lane], i) => {
    const z = 18 + i * 13 + Math.sin(t * 0.4 + i * 2) * 4;
    things.push({ z, paint: () => {
      const x = lane + Math.sin(t * 0.6 + i) * 0.25;
      const x1 = c.x(x - 0.95, z), x2 = c.x(x + 0.95, z);
      const top = c.y(1.45, z), mid = c.y(0.95, z), base = c.y(0.25, z), ground = c.y(0, z);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x1, base, x2 - x1, ground - base);
      g.fillStyle = color;
      g.fillRect(x1, mid, x2 - x1, base - mid);
      g.fillRect(x1 + (x2 - x1) * 0.12, top, (x2 - x1) * 0.76, mid - top);
      g.fillStyle = '#2b3640';
      g.fillRect(x1 + (x2 - x1) * 0.18, top + (mid - top) * 0.2, (x2 - x1) * 0.64, (mid - top) * 0.7);
      g.fillStyle = '#e74c3c';
      g.fillRect(x1 + (x2 - x1) * 0.04, mid + (base - mid) * 0.2, (x2 - x1) * 0.16, (base - mid) * 0.25);
      g.fillRect(x2 - (x2 - x1) * 0.2, mid + (base - mid) * 0.2, (x2 - x1) * 0.16, (base - mid) * 0.25);
    } });
  });
  things.sort((a, b) => b.z - a.z).forEach((o) => o.paint());

  // Our own bonnet along the bottom edge.
  g.fillStyle = '#1c2a3a';
  g.beginPath();
  g.moveTo(0, h);
  g.quadraticCurveTo(w / 2, h * 0.86, w, h);
  g.fill();
}

// ---- 2. Beach gym in the afternoon: a sideways pan past palms, gym racks and joggers ------------------------

function palm(g: Ctx, x: number, base: number, height: number, lean: number, trunk: string, leaves: string, size: number) {
  g.strokeStyle = trunk;
  g.lineWidth = Math.max(2, size * 0.12);
  g.beginPath();
  g.moveTo(x, base);
  g.quadraticCurveTo(x + lean * 0.5, base - height * 0.5, x + lean, base - height);
  g.stroke();
  g.fillStyle = leaves;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    g.beginPath();
    g.ellipse(x + lean + Math.cos(a) * size * 0.7, base - height + Math.sin(a) * size * 0.25, size * 0.8, size * 0.18, a, 0, Math.PI * 2);
    g.fill();
  }
}

function person(g: Ctx, x: number, ground: number, tall: number, stride: number, color: string) {
  const swing = Math.sin(stride) * tall * 0.18;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.5, tall * 0.09);
  g.lineCap = 'round';
  const hip = ground - tall * 0.48;
  const neck = ground - tall * 0.85;
  g.beginPath();
  g.moveTo(x, hip); g.lineTo(x + swing, ground);
  g.moveTo(x, hip); g.lineTo(x - swing, ground);
  g.moveTo(x, hip); g.lineTo(x, neck);
  g.moveTo(x, neck + tall * 0.06); g.lineTo(x - swing * 0.8, hip + tall * 0.02);
  g.moveTo(x, neck + tall * 0.06); g.lineTo(x + swing * 0.8, hip + tall * 0.02);
  g.stroke();
  g.beginPath();
  g.arc(x, neck - tall * 0.07, tall * 0.07, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'butt';
}

function beach(g: Ctx, w: number, h: number, t: number) {
  const pan = (layer: number) => t * w * 0.32 * layer;
  const sea = h * 0.4, shore = h * 0.6;
  g.fillStyle = vertical(g, 0, sea, ['#3b8fd3', '#bfe4f4']);
  g.fillRect(0, 0, w, sea);
  glow(g, w * 0.8, h * 0.16, h * 0.3, 'rgba(255,244,214,0.9)');
  g.fillStyle = '#fffaf0';
  g.beginPath();
  g.arc(w * 0.8, h * 0.16, h * 0.05, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = vertical(g, sea, shore, ['#1c7fa6', '#47c1c6']);
  g.fillRect(0, sea, w, shore - sea);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let r = 0; r < 6; r++) {
    const y = sea + (shore - sea) * ((r + 0.5) / 6);
    strip(w, pan(0.05 + r * 0.05) + r * 37, w * (0.12 + r * 0.02), (x) => g.fillRect(x, y, w * (0.03 + r * 0.008), Math.max(1, h * 0.004)));
  }
  g.fillStyle = vertical(g, shore, h, ['#efdcae', '#d9bb85']);
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 40) g.lineTo(x, shore + Math.sin(x / w * 18 + t * 1.6) * h * 0.008);
  g.lineTo(w, h);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = Math.max(1, h * 0.006);
  g.beginPath();
  for (let x = 0; x <= w; x += w / 40) g.lineTo(x, shore + Math.sin(x / w * 18 + t * 1.6) * h * 0.008);
  g.stroke();

  strip(w, pan(0.35), w * 0.26, (x, i) => palm(g, x, shore + h * 0.02, h * (0.36 + rand(i) * 0.1), (rand(i + 7) - 0.4) * w * 0.05, '#8b6b47', '#2f7a3d', h * 0.07));

  // Gym racks and benches on the sand.
  const floor = h * 0.86;
  strip(w, pan(0.8), w * 0.62, (x, i) => {
    g.fillStyle = '#4a4f55';
    const u = h * 0.012;
    g.fillRect(x, floor - h * 0.22, u, h * 0.22);
    g.fillRect(x + w * 0.12, floor - h * 0.22, u, h * 0.22);
    g.fillRect(x, floor - h * 0.17, w * 0.12 + u, u);
    for (const px of [x - w * 0.012, x + w * 0.132]) {
      g.fillStyle = '#1d1f22';
      g.beginPath(); g.arc(px, floor - h * 0.165, h * 0.05, 0, Math.PI * 2); g.fill();
      g.strokeStyle = i % 2 ? '#2ecc71' : '#e74c3c';
      g.lineWidth = Math.max(1, h * 0.008);
      g.beginPath(); g.arc(px, floor - h * 0.165, h * 0.035, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#2d3136';
    g.fillRect(x + w * 0.25, floor - h * 0.06, w * 0.13, h * 0.025);
    g.fillRect(x + w * 0.27, floor - h * 0.035, u, h * 0.035);
    g.fillRect(x + w * 0.36, floor - h * 0.035, u, h * 0.035);
  });
  // Joggers running against the pan.
  for (let i = 0; i < 4; i++) {
    const span = w * 1.4;
    const x = ((rand(i) * span + t * w * (0.12 + i * 0.02) - pan(0.8)) % span + span) % span - w * 0.2;
    person(g, x, floor + h * (0.02 + i * 0.015), h * (0.22 + rand(i + 3) * 0.05), t * (9 + i), ['#7a4a2a', '#3e2a1e', '#b07a52', '#5b3a26'][i]);
  }
  // Foreground trunks: the fastest layer.
  strip(w, pan(1.7), w * 0.85, (x) => {
    g.fillStyle = '#5e452c';
    g.fillRect(x, 0, w * 0.035, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < 12; k++) g.fillRect(x, (k / 12) * h, w * 0.035, h * 0.01);
  });
}

// ---- 3. Nightclub: sweeping beams, a turning mirror ball and a dancing crowd -----------------------------------

function club(g: Ctx, w: number, h: number, t: number) {
  g.fillStyle = '#0c0616';
  g.fillRect(0, 0, w, h);
  // LED wall: colour drifts smoothly (no flashing).
  const cols = 24, rows = 7;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      g.fillStyle = `hsla(${(k * 9 + r * 14 + t * 70) % 360}, 85%, 55%, 0.32)`;
      g.fillRect((k / cols) * w + 2, h * 0.08 + r * h * 0.06, w / cols - 4, h * 0.05);
    }
  }
  g.fillStyle = vertical(g, h * 0.55, h, ['#1d0d33', '#070310']);
  g.fillRect(0, h * 0.55, w, h * 0.45);

  // Beams from the rig, swinging back and forth.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const ox = ((i + 0.5) / 6) * w;
    const a = Math.sin(t * 1.4 + i * 1.3) * 0.7;
    const len = h * 1.3;
    const spread = 0.07;
    const grad = g.createLinearGradient(ox, 0, ox + Math.sin(a) * len, Math.cos(a) * len);
    const hue = (i * 60 + t * 25) % 360;
    grad.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.45)`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 65%, 0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(ox, 0);
    g.lineTo(ox + Math.sin(a - spread) * len, Math.cos(a - spread) * len);
    g.lineTo(ox + Math.sin(a + spread) * len, Math.cos(a + spread) * len);
    g.fill();
  }
  // Mirror-ball reflections travelling across the room.
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 46; i++) {
    const a = i * 2.39996 + t * 0.5;
    const x = ((Math.cos(a) * 0.5 + 0.5 + i * 0.137 + t * 0.06) % 1) * w;
    const y = h * (0.1 + rand(i) * 0.75);
    g.beginPath();
    g.arc(x, y, Math.max(1, h * 0.006), 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const bx = w * 0.5, by = h * 0.1, br = h * 0.055;
  g.fillStyle = '#c9ccd6';
  g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.clip();
  g.strokeStyle = '#6d7180';
  g.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    const lx = bx + Math.sin(((k / 8) * Math.PI * 2 + t * 1.2) % (Math.PI * 2)) * br;
    g.beginPath(); g.moveTo(lx, by - br); g.lineTo(lx, by + br); g.stroke();
  }
  for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(bx - br, by + k * br * 0.3); g.lineTo(bx + br, by + k * br * 0.3); g.stroke(); }
  g.restore();

  // The crowd, three rows deep, bobbing to about 128 beats a minute.
  const beat = t * 2.13 * Math.PI * 2;
  for (let row = 0; row < 3; row++) {
    const n = 9 + row * 3;
    const scale = 0.7 + row * 0.25;
    const base = h * (0.72 + row * 0.12);
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5 + (rand(i + row * 50) - 0.5) * 0.6) / n) * w + Math.sin(t * 0.8 + i) * w * 0.01;
      const bob = Math.abs(Math.sin(beat / 2 + i * 0.7)) * h * 0.025 * scale;
      const head = h * 0.045 * scale;
      const top = base - h * 0.2 * scale - bob;
      g.fillStyle = row === 2 ? '#030107' : row === 1 ? '#0a0414' : '#150a24';
      g.beginPath(); g.arc(x, top, head, 0, Math.PI * 2); g.fill();
      g.beginPath();
      g.roundRect(x - head * 1.6, top + head * 0.9, head * 3.2, h, head);
      g.fill();
      if (rand(i * 3 + row) > 0.55) {
        const wave = Math.sin(beat + i) * 0.5;
        g.strokeStyle = g.fillStyle;
        g.lineWidth = head * 0.6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x + head * 1.2, top + head * 1.3);
        g.lineTo(x + head * (1.6 + wave), top - head * 2.2);
        g.stroke();
        g.lineCap = 'butt';
      }
    }
  }
}

// ---- 4. Dusk street from the passenger seat: murals, people and a patrol car sliding past the side window ---------

function duskDrive(g: Ctx, w: number, h: number, t: number) {
  const pan = (layer: number) => t * w * 0.5 * layer;
  const shake = Math.sin(t * 13) * h * 0.003;
  g.fillStyle = vertical(g, 0, h * 0.7, ['#2b2452', '#7d4a86', '#f0a35e']);
  g.fillRect(0, 0, w, h);
  strip(w, pan(0.12), w * 0.09, (x, i) => {
    const bh = h * (0.15 + rand(i) * 0.25);
    g.fillStyle = '#3a2c4e';
    g.fillRect(x, h * 0.62 - bh, w * 0.08, bh);
    g.fillStyle = 'rgba(255,214,120,0.8)';
    for (let k = 0; k < 6; k++) if (rand(i * 7 + k) > 0.5) g.fillRect(x + w * (0.01 + (k % 3) * 0.023), h * 0.62 - bh + h * (0.03 + Math.floor(k / 3) * 0.05), w * 0.01, h * 0.015);
  });
  const ground = h * 0.7;
  const palette = ['#c0392b', '#2e86c1', '#f1c40f', '#16a085', '#8e44ad', '#e67e22', '#ecf0f1'];
  strip(w, pan(1), w * 0.4, (x, i) => {
    const top = h * (0.34 + rand(i + 5) * 0.08) + shake;
    g.fillStyle = palette[Math.floor(rand(i) * palette.length)];
    g.fillRect(x, top, w * 0.4 + 1, ground - top);
    for (let k = 0; k < 4; k++) {
      g.fillStyle = palette[Math.floor(rand(i * 5 + k) * palette.length)];
      const mx = x + w * 0.4 * rand(i * 11 + k), my = top + (ground - top) * (0.15 + rand(i * 13 + k) * 0.6);
      const ms = h * (0.05 + rand(i * 17 + k) * 0.08);
      g.beginPath();
      if (k % 2) g.arc(mx, my, ms, 0, Math.PI * 2);
      else g.rect(mx - ms, my - ms * 0.6, ms * 2, ms * 1.2);
      g.fill();
    }
  });
  // Dusk light: everything outside a little dimmer and warmer.
  g.fillStyle = 'rgba(60,24,70,0.28)';
  g.fillRect(0, h * 0.3, w, ground - h * 0.3 + shake);
  g.fillStyle = '#3d3b45';
  g.fillRect(0, ground + shake, w, h);
  g.fillStyle = '#26252c';
  g.fillRect(0, ground + h * 0.06 + shake, w, h);

  // A parked patrol car every few buildings, light bar pulsing slowly (well under 3 flashes a second).
  strip(w, pan(1), w * 1.6, (x) => {
    const cy = ground + h * 0.1 + shake;
    const cw = w * 0.28, ch = h * 0.06;
    g.fillStyle = '#0b0b0e';
    for (const wx of [x + cw * 0.2, x + cw * 0.8]) { g.beginPath(); g.arc(wx, cy, ch * 0.42, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f4f6f7';
    g.beginPath(); g.roundRect(x, cy - ch, cw, ch * 0.75, ch * 0.25); g.fill();
    g.fillStyle = '#1f2a36';
    g.fillRect(x + cw * 0.28, cy - ch * 0.85, cw * 0.44, ch * 0.4);
    g.fillStyle = '#f4f6f7';
    g.beginPath();
    g.moveTo(x + cw * 0.24, cy - ch); g.lineTo(x + cw * 0.34, cy - ch * 1.65);
    g.lineTo(x + cw * 0.7, cy - ch * 1.65); g.lineTo(x + cw * 0.8, cy - ch);
    g.fill();
    g.fillStyle = '#5d7d99';
    g.fillRect(x + cw * 0.36, cy - ch * 1.55, cw * 0.15, ch * 0.5);
    g.fillRect(x + cw * 0.53, cy - ch * 1.55, cw * 0.15, ch * 0.5);
    const blue = (Math.sin(t * Math.PI * 2 * 1.4) + 1) / 2;
    g.fillStyle = `rgba(70,130,255,${0.4 + blue * 0.6})`;
    g.fillRect(x + cw * 0.4, cy - ch * 1.8, cw * 0.1, ch * 0.15);
    g.fillStyle = `rgba(255,60,60,${1 - blue * 0.6})`;
    g.fillRect(x + cw * 0.5, cy - ch * 1.8, cw * 0.1, ch * 0.15);
    g.globalCompositeOperation = 'lighter';
    glow(g, x + cw * 0.45, cy - ch * 1.75, h * 0.1, 'rgba(60,120,255,1)', blue);
    glow(g, x + cw * 0.55, cy - ch * 1.75, h * 0.1, 'rgba(255,50,50,1)', 1 - blue);
    g.globalCompositeOperation = 'source-over';
  });
  // People on the pavement.
  strip(w, pan(1), w * 0.23, (x, i) => {
    if (rand(i + 99) < 0.45) return;
    person(g, x + w * 0.1, ground + h * 0.045 + shake, h * 0.27, rand(i) > 0.5 ? t * 7 + i : 0.4, '#16121c');
  });

  // The car's interior framing the side window.
  g.fillStyle = '#0a0a0d';
  g.fillRect(0, 0, w, h * 0.1 + shake);
  g.beginPath();
  g.moveTo(0, h * 0.08); g.lineTo(w * 0.14, h * 0.08); g.lineTo(w * 0.06, h * 0.8); g.lineTo(0, h * 0.8);
  g.fill();
  g.beginPath();
  g.moveTo(0, h); g.lineTo(0, h * 0.88 + shake);
  g.quadraticCurveTo(w * 0.5, h * 0.83 + shake, w, h * 0.9 + shake);
  g.lineTo(w, h);
  g.fill();
  g.fillStyle = '#18181d';
  g.beginPath(); g.roundRect(w * 0.84, h * 0.66 + shake, w * 0.11, h * 0.11, h * 0.03); g.fill();
}

// ---- 5. Night street: streetlights overhead and a truck ahead dragging a shower of sparks ----------------------

function nightStreet(g: Ctx, w: number, h: number, t: number) {
  const c = camera(w, h, 0.5, 1.4);
  const run = t * 22;
  g.fillStyle = vertical(g, 0, c.y0, ['#04060c', '#141c2e']);
  g.fillRect(0, 0, w, c.y0);
  glow(g, w * 0.5, c.y0, w * 0.4, 'rgba(255,150,80,0.25)');
  g.fillStyle = '#0d0f13';
  g.fillRect(0, c.y0, w, h);
  quad(g, [c.x(-7, 1), c.y(0, 1), c.x(7, 1), c.y(0, 1), c.x(7, 300), c.y(0, 300), c.x(-7, 300), c.y(0, 300)], '#17191f');
  for (const z of ahead(run, 10, 0.8, 160)) roadMark(g, c, 0, 0.1, z, z + 3, '#c9b25a');

  const things: { z: number; paint: () => void }[] = [];
  for (const z of ahead(run, 18, 1, 220)) {
    for (const side of [-1, 1]) things.push({ z, paint: () => {
      const x = side * 12, s = c.s(3, z);
      g.fillStyle = '#05070a';
      g.beginPath(); g.ellipse(c.x(x, z), c.y(3.2, z), s, s * 0.9, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(c.x(x, z) - c.s(0.3, z) / 2, c.y(2, z), c.s(0.3, z), c.y(0, z) - c.y(2, z));
    } });
  }
  for (const z of ahead(run + 9, 26, 1, 260)) {
    for (const side of [-1, 1]) things.push({ z, paint: () => {
      const x = side * 8, pw = Math.max(1, c.s(0.2, z));
      g.fillStyle = '#2a2d33';
      g.fillRect(c.x(x, z) - pw / 2, c.y(8, z), pw, c.y(0, z) - c.y(8, z));
      const lx = c.x(x - side * 2, z), ly = c.y(8, z);
      g.fillRect(Math.min(c.x(x, z), lx), ly, Math.abs(lx - c.x(x, z)), pw);
      g.globalCompositeOperation = 'lighter';
      glow(g, lx, ly + pw, c.s(3, z), 'rgba(255,170,90,0.9)');
      // Its reflection on the wet road, a faint streak that fades towards the camera.
      if (z > 5) {
        const ry = c.y(0, z);
        const len = Math.min(c.s(4, z), h * 0.25);
        const grad = g.createLinearGradient(0, ry, 0, ry + len);
        grad.addColorStop(0, 'rgba(255,170,90,0.22)');
        grad.addColorStop(1, 'rgba(255,170,90,0)');
        g.fillStyle = grad;
        g.fillRect(lx - c.s(0.15, z), ry, c.s(0.3, z), len);
      }
      g.globalCompositeOperation = 'source-over';
    } });
  }
  const tz = 13 + Math.sin(t * 0.7) * 1.5;
  const tx = 0.4 + Math.sin(t * 0.5) * 0.7;
  const bounce = Math.abs(Math.sin(t * 6)) * 0.03;
  things.push({ z: tz, paint: () => {
    const x1 = c.x(tx - 1.25, tz), x2 = c.x(tx + 1.25, tz);
    const top = c.y(3 + bounce, tz), bed = c.y(0.9 + bounce, tz), ground = c.y(0, tz);
    g.fillStyle = '#050608';
    for (const wx of [tx - 0.9, tx + 0.9]) g.fillRect(c.x(wx - 0.3, tz), c.y(0.9, tz), c.s(0.6, tz), ground - c.y(0.9, tz));
    g.fillStyle = '#2b2e36';
    g.fillRect(x1, top, x2 - x1, bed - top);
    g.strokeStyle = '#3c404a';
    g.lineWidth = Math.max(1, c.s(0.05, tz));
    for (let k = 1; k < 4; k++) { const y = top + (bed - top) * (k / 4); g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke(); }
    g.globalCompositeOperation = 'lighter';
    for (const lx of [x1 + (x2 - x1) * 0.08, x2 - (x2 - x1) * 0.08]) glow(g, lx, bed - (bed - top) * 0.1, c.s(0.9, tz), 'rgba(255,40,30,1)');
    g.globalCompositeOperation = 'source-over';
  } });
  things.sort((a, b) => b.z - a.z).forEach((o) => o.paint());

  // Sparks: each one's path is fixed by its index, so every panel shows the same shower.
  const rate = 160, life = 0.7;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let n = Math.floor((t - life) * rate); n <= Math.floor(t * rate); n++) {
    const born = n / rate;
    if (born > t) continue;
    const pos = (age: number) => {
      const x = tx + (rand(n) - 0.5) * 0.6 + (rand(n + 1) - 0.5) * 7 * age;
      let y = 0.1 + (1 + rand(n + 2) * 2.5) * age - 4.9 * age * age;
      if (y < 0) y = -y * 0.3;
      const z = tz - 1.3 - (6 + rand(n + 3) * 10) * age;
      return z > 0.6 ? [c.x(x, z), c.y(y, z), c.s(0.04, z)] : null;
    };
    const age = t - born;
    const a = pos(age), b = pos(Math.max(0, age - 0.025));
    if (!a || !b) continue;
    const fade = 1 - age / life;
    g.strokeStyle = `rgba(255,${Math.round(160 + 90 * fade)},${Math.round(60 * fade)},${fade})`;
    g.lineWidth = Math.max(1, a[2]);
    g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(a[0], a[1]); g.stroke();
  }
  g.lineCap = 'butt';
  g.globalCompositeOperation = 'source-over';
  glow(g, c.x(tx, tz - 1.3), c.y(0.1, tz - 1.3), c.s(1.6, tz), 'rgba(255,190,90,0.8)');
}

export const SCENES: Scene[] = [
  { name: 'Highway at midday', draw: highway },
  { name: 'Beach gym', draw: beach },
  { name: 'Nightclub', draw: club },
  { name: 'Dusk street', draw: duskDrive },
  { name: 'Night street', draw: nightStreet },
];

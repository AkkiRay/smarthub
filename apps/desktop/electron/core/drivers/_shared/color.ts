// Общие color-преобразования для драйверов: HSV/RGB/Mired/XY.
// Драйверы шлют цвет в разных представлениях, canonical state хаба — RGB int (0xRRGGBB).

export function rgbIntToTuple(rgb: number): [number, number, number] {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

export function tupleToRgbInt(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** HSV (h: 0..360, s: 0..1, v: 0..1) → 0xRRGGBB. */
export function hsvToRgbInt(h: number, s: number, v: number): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return tupleToRgbInt(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  );
}

export function rgbIntToHsv(rgb: number): { h: number; s: number; v: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Mired (1_000_000/K) ↔ Kelvin. ZigBee/Hue/Tradfri используют mired. */
export function miredToKelvin(mired: number): number {
  if (!mired) return 4000;
  return Math.round(1_000_000 / mired);
}

export function kelvinToMired(k: number): number {
  return Math.round(1_000_000 / Math.max(1500, Math.min(7000, k)));
}

/** CIE 1931 xy → sRGB. Hue/IKEA шлют XY вместо RGB. */
export function xyToRgbInt(x: number, y: number): number {
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / Math.max(y, 1e-6)) * x;
  const Z = (Y / Math.max(y, 1e-6)) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gamma = (v: number): number =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const max = Math.max(r, g, b, 1e-6);
  r = gamma(Math.max(0, r / max));
  g = gamma(Math.max(0, g / max));
  b = gamma(Math.max(0, b / max));
  return tupleToRgbInt(
    Math.round(Math.max(0, Math.min(1, r)) * 255),
    Math.round(Math.max(0, Math.min(1, g)) * 255),
    Math.round(Math.max(0, Math.min(1, b)) * 255),
  );
}

/** sRGB → CIE xy (для Hue/IKEA). */
export function rgbIntToXy(rgb: number): { x: number; y: number } {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin((rgb >> 16) & 0xff);
  const g = lin((rgb >> 8) & 0xff);
  const b = lin(rgb & 0xff);
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z || 1e-6;
  return { x: X / sum, y: Y / sum };
}

import { GrainGradient } from "@paper-design/shaders-react";
import { ClientOnly } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** FNV-1a over the id; every parameter below is a pure function of the hash. */
const hash = (input: string) => {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
};
const unit = (seed: number, index: number) => {
  // A second mixing round per parameter so neighbouring indices decorrelate.
  const mixed = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return (mixed >>> 8) / 0x01000000;
};
const shapes = ["wave", "dots", "truchet", "corners", "ripple", "blob", "sphere"] as const;

/**
 * OKLCH to sRGB hex. Working in OKLCH makes vibrancy and contrast controllable: chroma sets
 * saturation as perceived, lightness sets contrast as perceived. Out-of-gamut colours are pulled
 * back by lowering chroma until they fit, so hues stay put.
 */
const oklch = (l: number, c: number, hDeg: number): string => {
  const toHex = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  const convert = (chroma: number) => {
    const h = (hDeg * Math.PI) / 180;
    const a = chroma * Math.cos(h);
    const b = chroma * Math.sin(h);
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l_ ** 3;
    const m3 = m_ ** 3;
    const s3 = s_ ** 3;
    const linear = [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ];
    const srgb = linear.map((v) =>
      v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055,
    );
    return srgb;
  };
  let chroma = c;
  let rgb = convert(chroma);
  // Reduce chroma until the colour is inside sRGB; hue and lightness are preserved.
  while (chroma > 0.005 && rgb.some((v) => v < -0.002 || v > 1.002)) {
    chroma -= 0.01;
    rgb = convert(chroma);
  }
  return `#${rgb.map(toHex).join("")}`;
};

/** Hue offsets of the four bands relative to the base hue, by harmony scheme. */
const schemes = [
  [0, 30, 60, 90], // analogous sweep
  [0, 180, 30, 210], // complementary pairs
  [0, 120, 240, 60], // triadic plus a bridge
  [0, 150, 210, 30], // split complementary
] as const;

/** The shader parameters a workspace always gets: fixed by its id, animated slowly. */
export const markOf = (id: string) => {
  const seed = hash(id);
  const hue = unit(seed, 0) * 360;
  const scheme = schemes[Math.floor(unit(seed, 1) * schemes.length)] ?? schemes[0];
  // Lightness climbs across the bands so neighbours always differ, order shuffled by the id.
  const lightnessSteps = [0.5, 0.64, 0.78, 0.9];
  const rotate = Math.floor(unit(seed, 8) * lightnessSteps.length);
  const colors = scheme.map((offset, index) => {
    const l = lightnessSteps[(index + rotate) % lightnessSteps.length] ?? 0.7;
    // Vibrant throughout: chroma stays high, slightly lower on the lightest band.
    const c = l > 0.85 ? 0.14 : 0.2 + unit(seed, 10 + index) * 0.06;
    return oklch(l, c, (hue + offset) % 360);
  });
  return {
    colors,
    // The background is itself a saturated, darker band so no flat area dominates.
    colorBack: oklch(0.4, 0.17, (hue + 200) % 360),
    softness: 0.45 + unit(seed, 2) * 0.35,
    intensity: 0.5 + unit(seed, 3) * 0.3,
    noise: 0.03 + unit(seed, 4) * 0.07,
    shape: shapes[Math.floor(unit(seed, 5) * shapes.length)] ?? "corners",
    // The shader is always drawn at renderSize pixels, so this frames a few bands of the pattern.
    scale: 0.55 + unit(seed, 6) * 0.35,
    frame: Math.floor(unit(seed, 7) * 100_000),
    speed: 0.3,
  };
};

/**
 * A workspace's mark: a grain gradient whose colours, shape and texture come from its id, so it
 * looks the same everywhere and for everyone. Renders on the client only; the server sends the
 * background colour so nothing jumps on hydration.
 */
/** The pattern is drawn at this size and scaled to the mark, so it looks the same at any size. */
const renderSize = 128;
export function WorkspaceMark(props: {
  id: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const params = markOf(props.id);
  const size = props.size ?? 32;
  return (
    <span
      role="img"
      aria-label={props.name}
      className={cn("relative block shrink-0 overflow-hidden rounded-md", props.className)}
      style={{ backgroundColor: params.colorBack, width: size, height: size }}
    >
      <ClientOnly fallback={null}>
        <GrainGradient
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: renderSize,
            height: renderSize,
            transform: `scale(${size / renderSize})`,
            transformOrigin: "top left",
          }}
          colors={params.colors}
          colorBack={params.colorBack}
          softness={params.softness}
          intensity={params.intensity}
          noise={params.noise}
          shape={params.shape}
          scale={params.scale}
          frame={params.frame}
          speed={params.speed}
        />
      </ClientOnly>
    </span>
  );
}

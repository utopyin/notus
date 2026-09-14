import { Dithering } from "@paper-design/shaders-react";
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
    return linear.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
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

/**
 * The dithering parameters a workspace always gets. Two colours: a deep saturated background and
 * a bright ink far enough around the hue wheel to contrast, both from the id, plus the wave's
 * starting frame so a reload shows the same picture.
 */
export const markOf = (id: string) => {
  const seed = hash(id);
  const hue = unit(seed, 0) * 360;
  // Ink sits 120 to 220 degrees away: always a clear complement, never a near-duplicate.
  const inkHue = (hue + 120 + unit(seed, 1) * 100) % 360;
  return {
    colorBack: oklch(0.36 + unit(seed, 2) * 0.08, 0.16, hue),
    colorFront: oklch(0.78 + unit(seed, 3) * 0.08, 0.17, inkHue),
    scale: 1.1 + unit(seed, 4) * 0.3,
    frame: Math.floor(unit(seed, 5) * 100_000),
    speed: 1,
  };
};

/** The world box the wave is drawn in; "cover" scales it to the mark, so size never changes the look. */
const world = 256;

/**
 * A workspace's mark: a dithered wave whose two colours come from its id, so it looks the same
 * everywhere and for everyone. Renders on the client only; the server sends the background colour
 * so nothing jumps on hydration.
 */
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
        <Dithering
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          fit="cover"
          worldWidth={world}
          worldHeight={world}
          colorBack={params.colorBack}
          colorFront={params.colorFront}
          shape="wave"
          type="4x4"
          size={2}
          scale={params.scale}
          frame={params.frame}
          speed={params.speed}
        />
      </ClientOnly>
    </span>
  );
}

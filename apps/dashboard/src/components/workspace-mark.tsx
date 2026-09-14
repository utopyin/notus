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

/** The shader parameters a workspace always gets: fixed by its id, animated slowly. */
export const markOf = (id: string) => {
  const seed = hash(id);
  const hue = Math.floor(unit(seed, 0) * 360);
  const spread = 40 + Math.floor(unit(seed, 1) * 80);
  const colors = [0, 1, 2, 3].map((step) => {
    const h = (hue + step * spread) % 360;
    const s = 62 + Math.floor(unit(seed, 10 + step) * 26);
    const l = 48 + Math.floor(unit(seed, 20 + step) * 18);
    return `hsl(${h} ${s}% ${l}%)`;
  });
  return {
    colors,
    colorBack: `hsl(${(hue + 180) % 360} 45% 14%)`,
    softness: 0.35 + unit(seed, 2) * 0.5,
    intensity: 0.3 + unit(seed, 3) * 0.5,
    noise: 0.15 + unit(seed, 4) * 0.35,
    shape: shapes[Math.floor(unit(seed, 5) * shapes.length)] ?? "corners",
    scale: 0.8 + unit(seed, 6) * 0.8,
    frame: Math.floor(unit(seed, 7) * 100_000),
    speed: 0.3,
  };
};

/**
 * A workspace's mark: a grain gradient whose colours, shape and texture come from its id, so it
 * looks the same everywhere and for everyone. Renders on the client only; the server sends the
 * background colour so nothing jumps on hydration.
 */
export function WorkspaceMark(props: { id: string; name: string; className?: string }) {
  const params = markOf(props.id);
  return (
    <span
      role="img"
      aria-label={props.name}
      className={cn("relative block shrink-0 overflow-hidden rounded-md", props.className)}
      style={{ backgroundColor: params.colorBack }}
    >
      <ClientOnly fallback={null}>
        <GrainGradient
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
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

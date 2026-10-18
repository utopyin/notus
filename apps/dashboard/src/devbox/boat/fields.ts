import { isObject, type Json } from "../../lib/json";

export type MachineType = "" | "small" | "default" | "large" | "xlarge";
export const machineTypes: ReadonlyArray<Exclude<MachineType, "">> = [
  "small",
  "default",
  "large",
  "xlarge",
];

/**
 * The Boat configuration as the page edits it. `autoStop` is "" for Boat's own hour, "off" for
 * none, or a number of minutes; the document carries seconds.
 */
export interface Fields {
  readonly template: string;
  readonly type: MachineType;
  readonly autoStop: string;
}

const isType = (value: unknown): value is Exclude<MachineType, ""> =>
  typeof value === "string" && (machineTypes as ReadonlyArray<string>).includes(value);

export const fieldsOf = (config: Json | null | undefined): Fields => {
  if (!isObject(config)) return { template: "", type: "", autoStop: "" };
  const seconds = config.autoStopSeconds;

  return {
    template: typeof config.template === "string" ? config.template : "",
    type: isType(config.type) ? config.type : "",
    autoStop:
      seconds === null
        ? "off"
        : typeof seconds === "number"
          ? String(Math.round(seconds / 60))
          : "",
  };
};

const minutes = (text: string): number | null =>
  /^(0|[1-9][0-9]*)$/.test(text.trim()) ? Number(text.trim()) : null;

/** Blank fields are absent, so Boat's defaults apply; a blank snapshot uses the workspace default. */
export const configOf = (fields: Fields): Json => {
  const config: Record<string, Json> = {};

  if (fields.template) config.template = fields.template;
  if (fields.type) config.type = fields.type;

  if (fields.autoStop.trim() === "off") config.autoStopSeconds = null;
  else {
    const value = minutes(fields.autoStop);
    if (value !== null) config.autoStopSeconds = value * 60;
  }

  return config;
};

export const problemOf = (fields: Fields): string | null => {
  const text = fields.autoStop.trim();

  if (text === "" || text === "off") return null;

  const value = minutes(text);
  if (value === null) return "Auto-stop is a whole number of minutes, or off.";
  if (value < 1 || value > 43_200) return "Auto-stop is between 1 minute and 30 days.";
  return null;
};

const labels: Readonly<Record<string, string>> = {
  template: "Snapshot",
  type: "Size",
  autoStopSeconds: "Auto-stop (s)",
};

export const labelOf = (path: string): string => labels[path] ?? path;

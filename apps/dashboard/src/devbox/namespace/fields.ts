import {
  architectures,
  environmentNames,
  imageRefPattern,
  type Architecture,
} from "@notus/namespace/restricted";
import { isObject, type Json, type JsonObject } from "../../lib/json";

/**
 * The devbox configuration as the page edits it: one string per field, so a half-typed number is
 * still a field and not a broken document. `configOf` turns it into the JSON the provider's policy
 * validates, `fieldsOf` reads it back, and the form never sees the document itself.
 */
export type Egress = "unrestricted" | "allowed" | "policy";
export interface Variable {
  readonly name: string;
  readonly value: string;
}
export interface Fields {
  readonly imageRef: string;
  readonly site: string;
  readonly virtualCpu: string;
  readonly memoryMegabytes: string;
  readonly machineArch: "" | Architecture;
  readonly volumeSizeGb: string;
  readonly cacheVolumeSizeGb: string;
  /** Seconds; the document carries protobuf durations ("300s"). */
  readonly busyMinimumSeconds: string;
  readonly stoppedRetentionSeconds: string;
  readonly egress: Egress;
  /** One domain per line. */
  readonly allowedDomains: string;
  readonly advisory: boolean;
  readonly policyTag: string;
  readonly variables: ReadonlyArray<Variable>;
}

export const emptyFields: Fields = {
  imageRef: "",
  site: "",
  virtualCpu: "",
  memoryMegabytes: "",
  machineArch: "",
  volumeSizeGb: "",
  cacheVolumeSizeGb: "",
  busyMinimumSeconds: "",
  stoppedRetentionSeconds: "",
  egress: "unrestricted",
  allowedDomains: "",
  advisory: false,
  policyTag: "",
  variables: [],
};

const objectAt = (value: Json | undefined, key: string): JsonObject | null =>
  isObject(value) && isObject(value[key]) ? value[key] : null;

const stringAt = (value: JsonObject | null, key: string): string => {
  const field = value?.[key];
  return typeof field === "string" ? field : "";
};

/** Numbers and the string form of int64 both read as the digits typed. */
const numberAt = (value: JsonObject | null, key: string): string => {
  const field = value?.[key];
  return typeof field === "number" ? String(field) : typeof field === "string" ? field : "";
};

const secondsOf = (duration: string): string => {
  const match = /^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?)s$/.exec(duration);
  return match?.[1] ?? "";
};

const isArchitecture = (value: string): value is Architecture =>
  (architectures as ReadonlyArray<string>).includes(value);

export const fieldsOf = (config: Json | null | undefined): Fields => {
  if (!isObject(config)) return emptyFields;

  const shape = objectAt(config, "instanceShape");
  const arch = stringAt(shape, "machineArch");
  const network = objectAt(config, "networkPolicy");
  const domains = objectAt(network, "egressDomains");
  const policy = objectAt(network, "egressPolicy");
  const allowed = domains?.allowed;
  const environment = config.environment;

  return {
    imageRef: stringAt(config, "imageRef"),
    site: stringAt(config, "site"),
    virtualCpu: numberAt(shape, "virtualCpu"),
    memoryMegabytes: numberAt(shape, "memoryMegabytes"),
    machineArch: isArchitecture(arch) ? arch : "",
    volumeSizeGb: numberAt(config, "volumeSizeGb"),
    cacheVolumeSizeGb: numberAt(config, "cacheVolumeSizeGb"),
    busyMinimumSeconds: secondsOf(stringAt(config, "busyEnsureMinimumDuration")),
    stoppedRetentionSeconds: secondsOf(
      stringAt(objectAt(config, "ephemeral"), "stoppedRetentionDuration"),
    ),
    egress: policy ? "policy" : domains ? "allowed" : "unrestricted",
    allowedDomains: Array.isArray(allowed)
      ? allowed.filter((item) => typeof item === "string").join("\n")
      : "",
    advisory: domains?.advisory === true,
    policyTag: stringAt(policy, "tag"),
    variables: Array.isArray(environment)
      ? environment
          .filter(isObject)
          .map((item) => ({ name: stringAt(item, "name"), value: stringAt(item, "value") }))
      : [],
  };
};

const integer = (text: string): number | null =>
  /^(0|[1-9][0-9]*)$/.test(text.trim()) ? Number(text.trim()) : null;

const seconds = (text: string): string | null =>
  /^(0|[1-9][0-9]*)(\.[0-9]{1,9})?$/.test(text.trim()) ? `${text.trim()}s` : null;

const lines = (text: string): ReadonlyArray<string> =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The document the fields describe. Blank fields are absent, so the provider's defaults apply. */
export const configOf = (fields: Fields): Json => {
  const config: Record<string, Json> = { imageRef: fields.imageRef };

  if (fields.site.trim()) config.site = fields.site.trim();

  const cpu = integer(fields.virtualCpu);
  const memory = integer(fields.memoryMegabytes);

  if (cpu !== null || memory !== null || fields.machineArch) {
    config.instanceShape = {
      ...(cpu !== null ? { virtualCpu: cpu } : {}),
      ...(memory !== null ? { memoryMegabytes: memory } : {}),
      ...(fields.machineArch ? { machineArch: fields.machineArch } : {}),
      os: "linux",
    };
  }

  const volume = integer(fields.volumeSizeGb);

  if (volume !== null) config.volumeSizeGb = volume;

  const cache = integer(fields.cacheVolumeSizeGb);

  if (cache !== null) config.cacheVolumeSizeGb = cache;

  const busy = seconds(fields.busyMinimumSeconds);

  if (busy !== null) config.busyEnsureMinimumDuration = busy;

  const retention = seconds(fields.stoppedRetentionSeconds);

  if (retention !== null) config.ephemeral = { stoppedRetentionDuration: retention };

  if (fields.egress === "allowed")
    config.networkPolicy = {
      egressDomains: { allowed: lines(fields.allowedDomains), advisory: fields.advisory },
    };

  if (fields.egress === "policy")
    config.networkPolicy = { egressPolicy: { tag: fields.policyTag.trim() } };

  if (fields.variables.length > 0)
    config.environment = fields.variables.map((item) => ({
      name: item.name,
      value: item.value,
    }));

  return config;
};

/** What keeps the form from saving, in the words the field shows; null when nothing does. */
export const problemOf = (fields: Fields): string | null => {
  if (!fields.imageRef) return "No image is approved.";

  for (const [label, text] of [
    ["vCPUs", fields.virtualCpu],
    ["Memory", fields.memoryMegabytes],
    ["Volume size", fields.volumeSizeGb],
    ["Cache volume size", fields.cacheVolumeSizeGb],
  ] as const)
    if (text.trim() !== "" && integer(text) === null) return `${label} must be a whole number.`;
  for (const [label, text] of [
    ["Minimum busy time", fields.busyMinimumSeconds],
    ["Stopped retention", fields.stoppedRetentionSeconds],
  ] as const)
    if (text.trim() !== "" && seconds(text) === null)
      return `${label} must be a number of seconds.`;

  if (fields.egress === "allowed" && lines(fields.allowedDomains).length === 0)
    return "List at least one allowed domain.";

  if (fields.egress === "policy" && fields.policyTag.trim() === "")
    return "Name the egress policy.";

  const names = fields.variables.map((item) => item.name);

  if (names.some((name) => !(environmentNames as ReadonlyArray<string>).includes(name)))
    return "Choose a name for every variable.";

  if (new Set(names).size !== names.length) return "Each variable can be set once.";
  return null;
};

/** How a field reads in a change list; unknown paths read as themselves. */
const labels: Readonly<Record<string, string>> = {
  imageRef: "Image",
  site: "Region",
  "instanceShape.virtualCpu": "vCPUs",
  "instanceShape.memoryMegabytes": "Memory (MB)",
  "instanceShape.machineArch": "Architecture",
  "instanceShape.os": "OS",
  machineSize: "Machine size",
  volumeSizeGb: "Volume (GB)",
  cacheVolumeSizeGb: "Cache volume (GB)",
  busyEnsureMinimumDuration: "Minimum busy time",
  "ephemeral.stoppedRetentionDuration": "Stopped retention",
  "networkPolicy.egressDomains.allowed": "Allowed domains",
  "networkPolicy.egressDomains.advisory": "Advisory egress",
  "networkPolicy.egressPolicy.tag": "Egress policy",
};

export const labelOf = (path: string): string => {
  const variable = /^environment\.(\d+)\.(name|value)$/.exec(path);
  if (variable) return `Variable ${Number(variable[1]) + 1} ${variable[2]}`;
  return labels[path] ?? path;
};

/** An image reference reads as its name and the start of its digest. */
export const shortValue = (value: string): string => {
  if (imageRefPattern.test(value)) {
    const [name = "", digest = ""] = value.split("@sha256:");
    return `${name.slice(name.lastIndexOf("/") + 1)}@${digest.slice(0, 7)}`;
  }

  return value;
};

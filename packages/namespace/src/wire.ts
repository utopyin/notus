import * as Schema from "effect/Schema";

const optional = Schema.optionalKey;
const text = Schema.NonEmptyString;
const strings = Schema.Array(Schema.String);
const int32 = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2147483647 }));

const int64 = Schema.Union([
  Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
]).check(Schema.makeFilter((value) => BigInt(value) <= 9223372036854775807n));

const duration = Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]*)(\.[0-9]{1,9})?s$/));

const unreserved = text.check(
  Schema.makeFilter((value) => !value.toUpperCase().startsWith("NOTUS_")),
);
const sessionName = unreserved.check(Schema.makeFilter((value) => value.toLowerCase() !== "notus"));

const environment = Schema.Struct({
  name: unreserved,
  value: optional(Schema.String),
  fromSecretId: optional(text),
}).check(
  Schema.makeFilter((value) => (value.value !== undefined) !== (value.fromSecretId !== undefined)),
);
const networkPolicy = Schema.Struct({
  egressDomains: optional(
    Schema.Struct({ allowed: optional(strings), advisory: optional(Schema.Boolean) }),
  ),
  egressPolicy: optional(Schema.Struct({ tag: text })),
}).check(Schema.makeFilter((value) => !(value.egressDomains && value.egressPolicy)));

// A maintained projection for validation.
export const CreateSettings = Schema.Struct({
  imageName: optional(text),
  imageRef: optional(text),
  machineSize: optional(text),
  instanceShape: optional(
    Schema.Struct({
      virtualCpu: optional(int32),
      memoryMegabytes: optional(int32),
      machineArch: optional(text),
      os: optional(text),
      selectors: optional(
        Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
      ),
    }),
  ),
  site: optional(text),
  volumeName: optional(text),
  volumeSizeGb: optional(int64),
  cacheVolumeSizeGb: optional(int64),
  repository: optional(Schema.String),
  versionControl: optional(
    Schema.Struct({
      gitRepository: optional(Schema.String),
      ref: optional(Schema.String),
      checkoutMethod: optional(
        Schema.Literals([
          "CHECKOUT_METHOD_UNSPECIFIED",
          "CHECKOUT_METHOD_GIT_CLONE",
          "CHECKOUT_METHOD_GIT_SNAPSHOT_UNPACK",
          0,
          1,
          2,
        ]),
      ),
    }),
  ),
  privateFeatures: optional(strings),
  enabledFeatures: optional(strings),
  features: optional(Schema.Struct({ enabled: optional(strings) })),
  busyEnsureMinimumDuration: optional(duration),
  accessMode: optional(
    Schema.Literals(["ACCESS_MODE_UNSPECIFIED", "USER_PRIVATE", "TENANT_WIDE", 0, 1, 2]),
  ),
  sessions: optional(
    Schema.Array(
      Schema.Struct({ name: sessionName, emoji: optional(Schema.String), command: text }),
    ),
  ),
  integrations: optional(Schema.Struct({ tailscale: optional(Schema.Struct({ fromSpec: text })) })),
  documentedPurpose: optional(Schema.String),
  ephemeral: optional(Schema.Struct({ stoppedRetentionDuration: optional(duration) })),
  privileged: optional(Schema.Boolean),
  environment: optional(Schema.Array(environment)),
  networkPolicy: optional(networkPolicy),
}).check(
  Schema.makeFilter((value) =>
    (value.imageName !== undefined) !== (value.imageRef !== undefined)
      ? !(value.machineSize !== undefined && value.instanceShape !== undefined) &&
        !(value.repository !== undefined && value.versionControl !== undefined) &&
        new Set(value.environment?.map((item) => item.name)).size ===
          (value.environment?.length ?? 0) &&
        new Set(value.sessions?.map((item) => item.name)).size === (value.sessions?.length ?? 0)
      : false,
  ),
);

const Devbox = Schema.Struct({
  id: text,
  name: text,
  imageRef: optional(Schema.String),
  resolvedImage: optional(
    Schema.Struct({
      id: optional(Schema.String),
      name: optional(Schema.String),
      version: optional(int64),
    }),
  ),
  destroyedAt: optional(Schema.String),
  documentedPurpose: optional(Schema.String),
});

export const Response = Schema.Struct({ devbox: Devbox, instanceId: optional(Schema.String) });
export const ExpireResponse = Schema.Struct({ devboxes: optional(Schema.Array(Devbox)) });

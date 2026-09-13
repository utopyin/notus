import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Config } from "./config";
import { ConfigError } from "./errors";
import type { Configuration, RestrictedInput } from "./types";
import { CreateSettings } from "./wire";

const optional = Schema.optionalKey;
const empty = Schema.Record(Schema.String, Schema.Never);
const emptyList = Schema.Array(Schema.Never);
const fields = CreateSettings.fields;
const imageRef = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.isPattern(
    /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:(?:[._-]|\/)[a-z0-9]+)*@sha256:[a-f0-9]{64}$/,
  ),
);
// Deliberately small: loader, shell, runtime, proxy and model environment overrides are unsafe.
const environment = Schema.Struct({
  name: Schema.Literals([
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
    "PROJECT_VARIANT",
  ]),
  value: Schema.String.check(Schema.isMaxLength(256), Schema.isPattern(/^[\x20-\x7e]*$/)),
});
const restricted = Schema.Struct({
  imageRef,
  machineSize: fields.machineSize,
  instanceShape: optional(
    Schema.Struct({
      virtualCpu: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2147483647 }))),
      memoryMegabytes: optional(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2147483647 })),
      ),
      machineArch: optional(Schema.Literals(["amd64", "arm64"])),
      os: optional(Schema.Literal("linux")),
    }),
  ),
  site: fields.site,
  volumeSizeGb: fields.volumeSizeGb,
  cacheVolumeSizeGb: fields.cacheVolumeSizeGb,
  busyEnsureMinimumDuration: fields.busyEnsureMinimumDuration,
  ephemeral: fields.ephemeral,
  networkPolicy: fields.networkPolicy,
  versionControl: optional(empty),
  privileged: optional(Schema.Literal(false)),
  accessMode: optional(Schema.Literals(["USER_PRIVATE", 1])),
  privateFeatures: optional(emptyList),
  enabledFeatures: optional(emptyList),
  features: optional(Schema.Struct({ enabled: optional(emptyList) })),
  integrations: optional(empty),
  sessions: optional(emptyList),
  environment: optional(Schema.Array(environment)),
});

export const validateRestricted = Effect.fn("Namespace.validateRestricted")(function* (
  input: RestrictedInput,
): Effect.fn.Return<Configuration, ConfigError> {
  const config = yield* Config.decode(input.config);
  if (input.approvedImageSource !== "audited-no-checkout-or-startup") {
    return yield* new ConfigError({
      message: "Restricted launch requires a host-audited image source and metadata",
    });
  }
  yield* Schema.decodeEffect(imageRef)(input.approvedImageRef).pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message: "Approved image must be an explicit immutable OCI sha256 reference",
        }),
    ),
  );
  yield* Schema.decodeUnknownEffect(restricted)(config.raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      () =>
        new ConfigError({ message: "Unsupported or conflicting restricted native configuration" }),
    ),
  );
  if (config.raw.imageRef !== input.approvedImageRef) {
    return yield* new ConfigError({
      message: "Configuration must select the exact approved imageRef",
    });
  }
  return config;
});

export const purpose = (operationId: string) => `notus:restricted:v1:${operationId}`;

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Config } from "./config";
import { ConfigError } from "./errors";
import {
  architectures,
  environmentNames,
  environmentValueLength,
  environmentValuePattern,
  imageRefPattern,
} from "./restricted";
import type { Configuration, RestrictedInput } from "./types";
import { CreateSettings } from "./wire";

const optional = Schema.optionalKey;
const empty = Schema.Record(Schema.String, Schema.Never);
const emptyList = Schema.Array(Schema.Never);
const fields = CreateSettings.fields;
const imageRef = Schema.String.check(Schema.isMaxLength(1024), Schema.isPattern(imageRefPattern));

// Deliberately small: loader, shell, runtime, proxy and model environment overrides are unsafe.
const environment = Schema.Struct({
  name: Schema.Literals(environmentNames),
  value: Schema.String.check(
    Schema.isMaxLength(environmentValueLength),
    Schema.isPattern(environmentValuePattern),
  ),
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
      machineArch: optional(Schema.Literals(architectures)),
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

  yield* Schema.decodeEffect(Schema.Array(imageRef))(input.approvedImageRefs).pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message: "Approved images must be explicit immutable OCI sha256 references",
        }),
    ),
  );

  yield* Schema.decodeUnknownEffect(restricted)(config.raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      () =>
        new ConfigError({ message: "Unsupported or conflicting restricted native configuration" }),
    ),
  );

  if (!input.approvedImageRefs.includes(config.raw.imageRef as string)) {
    return yield* new ConfigError({
      message: "Configuration must select one of the workspace's images",
    });
  }

  return config;
});

export const purpose = (operationId: string) => `notus:restricted:v1:${operationId}`;

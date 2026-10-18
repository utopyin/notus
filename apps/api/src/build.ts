import type { BuildStep } from "@notus/compute/adapter";
import { Provider } from "@notus/compute/provider";
import { SharedDb } from "@notus/db/shared";
import { Sealed } from "@notus/cloudflare/sealed";
import { Providers } from "@notus/executions/providers";
import { Compute } from "@notus/workspaces/compute";
import { Templates } from "@notus/workspaces/templates";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { computeConfig, credentialKeyConfig } from "./config";
import { registry } from "./runtime";

/** What a build of the Notus template in one workspace's account last did. */
const Record = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  provider: Provider,
  /** The admin who asked; the finished template is added in their name. */
  actorId: Schema.NonEmptyString,
  operationId: Schema.NonEmptyString,
  /** The adapter's own JSON, stored unread. */
  progress: Schema.NullOr(Schema.Json),
  status: Schema.Literals(["building", "ready", "failed"]),
  startedAt: Schema.Int,
  finishedAt: Schema.NullOr(Schema.Int),
  ref: Schema.NullOr(Schema.String),
  /** User-facing, from the adapter or this object; never a provider's own message. */
  reason: Schema.NullOr(Schema.String),
  /** Consecutive failed steps; a step that moves on resets it. */
  failures: Schema.Int,
});

type Record = typeof Record.Type;

/** What the dashboard sees of a build. */
export interface BuildView {
  readonly status: Record["status"];
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly ref: string | null;
  readonly reason: string | null;
}

const key = "build";
/** A build that has not finished by then is abandoned and its machine removed. */
const deadlineMs = 45 * 60_000;
/** Failed steps in a row before the build is abandoned; each waits a little longer. */
const maxFailures = 5;
const retryMs = 30_000;
/** A step can run the recipe for up to ten minutes; an alarm lost with it wakes after that. */
const recoveryMs = 11 * 60_000;
const label = "Notus base";

const viewOf = (record: Record): BuildView => ({
  status: record.status,
  startedAt: record.startedAt,
  finishedAt: record.finishedAt,
  ref: record.ref,
  reason: record.reason,
});

/**
 * Builds the Notus template in one workspace's own provider account, addressed by
 * `workspaceId:provider`. Each alarm takes the adapter's build one step further and stores where it
 * stands, so a build survives restarts and a step that fails is retried. A finished template is
 * added to the workspace's templates, and becomes the default when there is none.
 */
export class Build extends Cloudflare.DurableObject<Build>()(
  "Build",
  Effect.gen(function* () {
    const host = yield* Cloudflare.DurableObjectState;
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    const computeProviders = yield* computeConfig.pipe(Effect.orDie);
    const shared = Layer.succeed(SharedDb.Service, yield* SharedDb.Service);

    return { host, credentialKey, computeProviders, shared };
  }).pipe(
    Effect.provide(SharedDb.layer),
    Effect.map(({ host, credentialKey, computeProviders, shared }) =>
      Effect.gen(function* () {
        // The workspace's account and templates live in the shared database.
        const workspace = Layer.merge(Templates.layer, Compute.credentials).pipe(
          Layer.provide([shared, Sealed.layer(credentialKey)]),
        );

        const services = yield* Layer.build(
          Layer.merge(registry(computeProviders).pipe(Layer.provide(workspace)), workspace),
        ).pipe(Effect.orDie);

        const providers = yield* Providers.Service.pipe(Effect.provideContext(services));
        const templates = yield* Templates.Service.pipe(Effect.provideContext(services));

        const load = host.storage.get(key).pipe(
          Effect.flatMap((stored) =>
            stored === undefined
              ? Effect.succeed(Option.none<Record>())
              : Schema.decodeUnknownEffect(Record)(stored).pipe(Effect.asSome),
          ),
          Effect.orDie,
        );

        const save = (record: Record) => host.storage.put(key, record);

        const finish = (record: Record, now: number, change: Partial<Record>) =>
          save({ ...record, ...change, progress: null, finishedAt: now });

        /** The template is the workspace's now; with no default yet, it becomes the default. */
        const adopt = (record: Record, ref: string, now: number) =>
          Effect.gen(function* () {
            yield* templates.add(
              record.workspaceId,
              record.actorId,
              record.provider,
              ref,
              label,
              now,
            );

            const set = yield* templates.approved(record.workspaceId, record.provider);

            if (set.default === null)
              yield* templates.setDefault(record.workspaceId, record.actorId, record.provider, ref);
          });

        const step = Effect.gen(function* () {
          const loaded = yield* load;

          if (Option.isNone(loaded) || loaded.value.status !== "building") return;

          const record = loaded.value;
          const now = yield* Clock.currentTimeMillis;

          // Wakes again should this step's isolate end before it stores anything.
          yield* host.storage.setAlarm(now + recoveryMs);

          const found = yield* providers
            .forWorkspace({ workspaceId: record.workspaceId, provider: record.provider })
            .pipe(Effect.option);

          if (Option.isNone(found)) {
            yield* host.storage.deleteAlarm();

            return yield* finish(record, now, {
              status: "failed",
              reason: "The provider account is no longer connected.",
            });
          }

          const port = found.value;
          const build = { operationId: record.operationId, progress: record.progress };

          const giveUp = (reason: string) =>
            port.discardBuild(build).pipe(
              Effect.tapError((error) => Effect.logWarning(`build.discard_failed ${error._tag}`)),
              Effect.ignore,
              Effect.andThen(host.storage.deleteAlarm()),
              Effect.andThen(finish(record, now, { status: "failed", reason })),
            );

          if (now - record.startedAt > deadlineMs)
            return yield* giveUp("The build took too long and was stopped.");

          const result = yield* port.build(build).pipe(Effect.result);

          if (result._tag === "Failure") {
            const error = result.failure;

            yield* Effect.logWarning(
              `build.step_failed ${error._tag}${error._tag === "Compute.ComputeError" ? ` ${error.outcome}` : ""}`,
            );

            if (error._tag === "Compute.CapabilityNotSupported")
              return yield* giveUp(`${port.descriptor.name} cannot build the Notus template.`);

            const failures = record.failures + 1;

            if (failures >= maxFailures)
              return yield* giveUp(`${port.descriptor.name} kept refusing the build.`);

            yield* save({ ...record, failures });

            return yield* host.storage.setAlarm(now + retryMs * failures);
          }

          const next: BuildStep = result.success;

          switch (next._tag) {
            case "Continue": {
              yield* save({ ...record, progress: next.progress, failures: 0 });
              return yield* host.storage.setAlarm(now + Math.max(1, next.afterMs));
            }
            case "Failed": {
              yield* host.storage.deleteAlarm();
              return yield* finish(record, now, { status: "failed", reason: next.reason });
            }
            case "Ready": {
              const adopted = yield* adopt(record, next.ref, now).pipe(Effect.result);

              if (adopted._tag === "Failure") {
                const reason = adopted.failure.reason;

                yield* Effect.logWarning(`build.adopt_failed ${reason}`);

                // Only a storage hiccup is worth another try; the template itself is ready.
                if (reason === "storage" && record.failures + 1 < maxFailures) {
                  yield* save({ ...record, failures: record.failures + 1 });
                  return yield* host.storage.setAlarm(now + retryMs);
                }

                yield* host.storage.deleteAlarm();

                return yield* finish(record, now, {
                  status: "failed",
                  ref: next.ref,
                  reason: `The template ${next.ref} is ready, but adding it to the workspace failed. An admin can add it by name.`,
                });
              }

              yield* host.storage.deleteAlarm();

              return yield* finish(record, now, { status: "ready", ref: next.ref, reason: null });
            }
          }
        }).pipe(
          Effect.tapCause((cause) => Effect.logError("build.alarm_failed", cause)),
          // A defect rejects the alarm, which Cloudflare retries.
          Effect.orDie,
        );

        return {
          /** The last build, or null when this workspace never built one with this provider. */
          status: () => load.pipe(Effect.map(Option.map(viewOf)), Effect.map(Option.getOrNull)),
          /**
           * Starts a build unless one is running, which it reports instead; null for input no
           * build can have. The caller checked that `actorId` is an admin of a workspace
           * connected to `provider`.
           */
          start: (workspaceId: string, provider: string, actorId: string) =>
            host.blockConcurrencyWhile(() =>
              Effect.gen(function* () {
                const current = yield* load;

                if (Option.isSome(current) && current.value.status === "building")
                  return viewOf(current.value);

                const now = yield* Clock.currentTimeMillis;

                const decoded = yield* Schema.decodeUnknownEffect(Record)({
                  workspaceId,
                  provider,
                  actorId,
                  operationId: crypto.randomUUID(),
                  progress: null,
                  status: "building",
                  startedAt: now,
                  finishedAt: null,
                  ref: null,
                  reason: null,
                  failures: 0,
                }).pipe(Effect.option);

                if (Option.isNone(decoded)) return null;

                const record = decoded.value;

                yield* save(record);
                yield* host.storage.setAlarm(now + 1);

                return viewOf(record);
              }),
            ),
          alarm: () => step,
        };
      }),
    ),
  ),
) {}

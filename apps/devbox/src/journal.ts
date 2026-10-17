import * as Protocol from "@notus/control/runtime/protocol";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { validateDirectories } from "./host";
import { Failure, Settings } from "./settings";

const Pending = Schema.Struct({
  request: Protocol.EnrollmentRequest,
  observationId: Protocol.ReadinessRequest.fields.observationId,
  reply: Schema.NullOr(Protocol.EnrollmentReply),
  acknowledgment: Schema.NullOr(Protocol.ReadinessReply),
}).check(Schema.makeFilter((pending) => pending.acknowledgment === null || pending.reply !== null));
const Journal = Schema.Struct({
  version: Schema.Literal(1),
  controlUrl: Schema.NonEmptyString,
  credential: Schema.RedactedFromValue(Schema.NonEmptyString),
  pending: Schema.NullOr(Pending),
});
export interface Journal extends Schema.Schema.Type<typeof Journal> {}
const codec = Schema.fromJsonString(Journal);

export const open = Effect.fn("Devbox.Journal.open")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const settings = yield* Settings.Service;
    const directory = `${settings.stateRoot}/control`;
    const path = `${directory}/journal.json`;
    const validate = Effect.gen(function* () {
      yield* validateDirectories(settings).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      const stat = yield* fs.stat(directory);
      if (
        stat.type !== "Directory" ||
        !Option.contains(stat.uid, 1001) ||
        (stat.mode & 0o7777) !== 0o700 ||
        (yield* fs.realPath(directory)) !== directory
      )
        return yield* new Failure({ reason: "state" });
    });
    const validateFile = Effect.fn("Devbox.Journal.validateFile")(function* (file: string) {
      const stat = yield* fs.stat(file);
      if (
        stat.type !== "File" ||
        !Option.contains(stat.uid, 1001) ||
        (stat.mode & 0o7777) !== 0o600 ||
        !Option.contains(stat.nlink, 1n) ||
        stat.size > 32 * 1024 ||
        (yield* fs.realPath(file)) !== file
      )
        return yield* new Failure({ reason: "state" });
    });
    const syncDirectory = (dir: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(dir, { flag: "r" });
          yield* file.sync;
        }),
      );
    // Validate the current boot owner before creating anything in retained state.
    yield* validateDirectories(settings).pipe(Effect.provideService(FileSystem.FileSystem, fs));
    yield* fs.makeDirectory(directory, { mode: 0o700 }).pipe(Effect.catch(() => validate));
    yield* validate;
    yield* syncDirectory(settings.stateRoot);
    // Inspect entries, not exists(): dangling symlinks must not look absent.
    const entries = yield* fs.readDirectory(directory);
    for (const entry of entries) {
      if (entry !== "journal.json" && !/^journal\.[0-9a-f-]+\.tmp$/.test(entry))
        return yield* new Failure({ reason: "state" });
      yield* validateFile(`${directory}/${entry}`);
    }
    const read = Effect.gen(function* () {
      yield* validate;
      if (!(yield* fs.readDirectory(directory)).includes("journal.json")) return null;
      yield* validateFile(path);
      return yield* fs.readFileString(path).pipe(Effect.flatMap(Schema.decodeEffect(codec)));
    }).pipe(Effect.mapError(() => new Failure({ reason: "state" })));
    const write = Effect.fn("Devbox.Journal.write")((value: Journal) =>
      Effect.gen(function* () {
        yield* validate;
        if ((yield* fs.readDirectory(directory)).includes("journal.json"))
          yield* validateFile(path);
        const text = yield* Schema.encodeEffect(codec)(value);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > 32 * 1024) return yield* new Failure({ reason: "state" });
        const temporary = `${directory}/journal.${yield* crypto.randomUUIDv4()}.tmp`;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(temporary, { flag: "wx", mode: 0o600 });
            yield* file.writeAll(bytes);
            yield* file.sync;
          }),
        );
        yield* fs.rename(temporary, path);
        yield* syncDirectory(directory);
        // Only the committed journal is authoritative. Interrupted writes are never adopted.
        for (const entry of yield* fs.readDirectory(directory)) {
          if (/^journal\.[0-9a-f-]+\.tmp$/.test(entry)) {
            yield* validateFile(`${directory}/${entry}`);
            yield* fs.remove(`${directory}/${entry}`);
          }
        }
      }).pipe(
        Effect.uninterruptible,
        Effect.mapError(() => new Failure({ reason: "state" })),
      ),
    );
    return { read, write };
  },
  Effect.mapError(() => new Failure({ reason: "state" })),
);

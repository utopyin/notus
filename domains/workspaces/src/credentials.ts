import { D1 } from "@notus/cloudflare/d1";
import { Sealed } from "@notus/cloudflare/sealed";
import { CredentialError, InstallationCredentials } from "@notus/platform/credentials";
import type { InstallationRef } from "@notus/platform/ids";
import { key } from "@notus/platform/source";
import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { installations } from "./schema";

const credentialJson = Schema.fromJsonString(Schema.Json);

/**
 * Installation credentials live on the installation row, sealed; only this layer reads or writes
 * the column, and only through the deployment's key.
 */
export const layerNoDeps = Layer.effect(
  InstallationCredentials,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const sealed = yield* Sealed.Service;
    const get = Effect.fn("Credentials.get")(
      function* (ref: InstallationRef) {
        const rows = yield* store.db
          .select({ credential: installations.credential })
          .from(installations)
          .where(eq(installations.key, key(ref.platform, ref.installationId)));
        const stored = rows[0]?.credential;
        if (stored === undefined || stored === null) return Option.none();
        return Option.some(yield* Schema.decodeEffect(credentialJson)(yield* sealed.open(stored)));
      },
      Effect.mapError((cause) => new CredentialError({ operation: "get", cause })),
    );
    const put = Effect.fn("Credentials.put")(
      function* (ref: InstallationRef, credential: Schema.Json) {
        const encoded = yield* sealed.seal(yield* Schema.encodeEffect(credentialJson)(credential));
        yield* store.batch([
          sql`UPDATE workspace_installations SET credential = ${encoded}
          WHERE key = ${key(ref.platform, ref.installationId)}`,
        ]);
      },
      Effect.mapError((cause) => new CredentialError({ operation: "put", cause })),
    );
    return InstallationCredentials.of({ get, put });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Credentials from "./credentials";

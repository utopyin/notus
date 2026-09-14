import { D1 } from "@notus/cloudflare/d1";
import { key, Source } from "@notus/contracts/source";
import { eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { AccessError, Denied } from "./errors";
import { channels, memberships } from "./schema";
import { Conversation, Fixture, PullConversation, StartGrant } from "./types";

export interface Interface {
  readonly authorizeSource: (
    workspaceId: string,
    source: Source,
  ) => Effect.Effect<void, AccessError | Denied>;
  readonly authorizeStart: (
    workspaceId: string,
    userId: string,
    source: Source,
  ) => Effect.Effect<StartGrant, AccessError | Denied>;
  readonly seedFixture: (fixture: Fixture) => Effect.Effect<void, AccessError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/access/Service",
) {}
const ChannelRow = createSelectSchema(channels);
const MemberRow = createSelectSchema(memberships);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const authorizeSource = Effect.fn("Access.authorizeSource")(function* (
      workspaceId: string,
      value: Source,
    ) {
      const source = yield* Schema.decodeEffect(Source)(value).pipe(
        Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
      );
      // Slack sources are allowed channels; GitHub sources are pull requests in allowed repositories.
      const channelId =
        source.kind === "github"
          ? yield* Schema.decodeEffect(PullConversation)(source.conversationId).pipe(
              Effect.map(([owner, name]) => `${owner}/${name}`),
              Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
            )
          : (yield* Schema.decodeEffect(Conversation)(source.conversationId).pipe(
              Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
            ))[0];
      const rows = yield* store.db
        .select()
        .from(channels)
        .where(eq(channels.key, key(workspaceId, source.installationId, channelId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ChannelRow))),
          Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
        );
      if (rows.length === 0)
        return yield* new Denied({
          workspaceId,
          reason: "Source is not an administrator-configured fixture channel",
        });
    });
    const authorizeStart = Effect.fn("Access.authorizeStart")(function* (
      workspaceId: string,
      userId: string,
      source: Source,
    ) {
      yield* authorizeSource(workspaceId, source);
      const rows = yield* store.db
        .select()
        .from(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
          Effect.mapError((cause) => new AccessError({ operation: "authorizeStart", cause })),
        );
      if (rows.length === 0)
        return yield* new Denied({
          workspaceId,
          reason: "Initiator is not a fixture workspace member",
        });
      return { workspaceId, initiatorId: userId };
    });
    const seedFixture = Effect.fn("Access.seedFixture")(
      function* (value: Fixture) {
        const { workspaceId, userId, teamId, channelId, github } =
          yield* Schema.decodeEffect(Fixture)(value);
        if (github)
          yield* store.batch([
            sql`INSERT INTO workspace_channels (key, workspaceId, teamId, channelId)
            VALUES (${key(workspaceId, github.installationId, github.fullName)}, ${workspaceId}, ${github.installationId}, ${github.fullName}) ON CONFLICT DO NOTHING`,
          ]);
        yield* store.batch([
          sql`INSERT INTO workspace_channels (key, workspaceId, teamId, channelId)
          VALUES (${key(workspaceId, teamId, channelId)}, ${workspaceId}, ${teamId}, ${channelId}) ON CONFLICT DO NOTHING`,
          sql`INSERT INTO workspace_memberships (key, workspaceId, userId, provenance)
          VALUES (${key(workspaceId, userId)}, ${workspaceId}, ${userId}, 'admin-fixture') ON CONFLICT DO NOTHING`,
        ]);
      },
      Effect.mapError((cause) => new AccessError({ operation: "seedFixture", cause })),
    );
    return Service.of({ authorizeSource, authorizeStart, seedFixture });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Access from "./access";

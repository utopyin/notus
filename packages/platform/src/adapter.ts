import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { CapabilityNotSupportedError } from "./capabilities";
import type { PlatformDescriptor } from "./descriptor";
import type { InstallationNotFound, SourceError } from "./errors";
import type { InstallationRef, PlatformId } from "./ids";
import type { PlatformIngress } from "./ingress";
import type { Platform } from "./platform";
import type { Actor, ReplyTarget, Scope, Source } from "./source";

export const Receipt = Schema.Struct({
  reference: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString,
});
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

/** Runtime-only handles. Persist ReplyTarget, never these closures. */
export interface ReplyHandle {
  readonly react: (deliveryId: string) => Effect.Effect<Receipt, SourceError>;
  readonly reply: (text: string, deliveryId: string) => Effect.Effect<Receipt, SourceError>;
}
export interface UpdateHandle {
  readonly send: (text: string, deliveryId: string) => Effect.Effect<Receipt, SourceError>;
}

export interface Conversations {
  readonly resolveReply: (target: ReplyTarget) => Effect.Effect<ReplyHandle, SourceError>;
  /** origin must be the task's persisted immutable origin, not an incoming source. */
  readonly resolveUpdates: (
    origin: Source,
    target: Source,
  ) => Effect.Effect<UpdateHandle, SourceError>;
}
export interface Scopes {
  readonly list: Effect.Effect<ReadonlyArray<Scope>, SourceError | CapabilityNotSupportedError>;
}
export interface Identity {
  /** Whether this actor's input in this scope is taken up at all; workspace authorization is separate. */
  readonly mayParticipate: (actor: Actor, scope: PlatformId) => Effect.Effect<boolean, SourceError>;
}

/** What an adapter can do for one installation; every value here is a plain closure over its config. */
export interface InstallationSurfaces {
  readonly scopes: Scopes;
  readonly conversations: Conversations;
  readonly identity: Identity;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly descriptor: PlatformDescriptor;
  readonly ingress: PlatformIngress;
  readonly forInstallation: (
    ref: InstallationRef,
  ) => Effect.Effect<InstallationSurfaces, InstallationNotFound>;
}

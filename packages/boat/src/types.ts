import * as Schema from "effect/Schema";

export const SandboxId = Schema.String.check(
  Schema.isPattern(/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/),
);
export const MachineType = Schema.Literals(["small", "default", "large", "xlarge"]);
export type MachineType = typeof MachineType.Type;
/** A named snapshot, or another account's share code. */
export const TemplateName = Schema.String.check(
  Schema.isPattern(/^(?:bsh_[A-Za-z0-9_-]{1,128}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/),
);

/** The states the API reports; `archived` is stopped, `cancelled` is gone. */
export const State = Schema.Literals([
  "init",
  "provisioning",
  "provisioned",
  "cloning",
  "ready",
  "idle",
  "running",
  "archiving",
  "archived",
  "error",
  "cancelled",
]);
export type State = typeof State.Type;

/** Only the fields Notus reads. Desktop URLs and other secret-bearing fields are never decoded. */
export const Sandbox = Schema.Struct({
  id: SandboxId,
  name: Schema.String,
  state: State,
});
export interface Sandbox extends Schema.Schema.Type<typeof Sandbox> {}

/** A name Boat saves a snapshot under: what `from` then starts a sandbox from. */
export const SnapshotName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/));

export const SnapshotStatus = Schema.Literals(["saving", "ready", "failed"]);
export type SnapshotStatus = typeof SnapshotStatus.Type;

/** Only the fields Notus reads; Boat's error text stays out. */
export const NamedSnapshot = Schema.Struct({
  name: SnapshotName,
  status: SnapshotStatus,
});
export interface NamedSnapshot extends Schema.Schema.Type<typeof NamedSnapshot> {}

export interface CreateInput {
  /** Account-unique; Boat returns the same sandbox for the same key and body within 24 hours. */
  readonly idempotencyKey: string;
  /** A named snapshot or share code; absent for Boat's own base machine. */
  readonly from?: string;
  readonly type?: MachineType;
  /** Null disables auto-stop. */
  readonly ttlSeconds?: number | null;
  readonly env?: Readonly<Record<string, string>>;
  readonly setupScript?: string;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

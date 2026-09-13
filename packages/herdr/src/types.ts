import * as Schema from "effect/Schema";

export const version = "0.9.0";
export const protocol = 22;

export const Ping = Schema.Struct({
  type: Schema.Literal("pong"),
  version: Schema.String,
  protocol: Schema.Int,
});
export interface Ping extends Schema.Schema.Type<typeof Ping> {}

// Deliberate readiness projection of protocol 22. Drop labels, paths, tokens,
// native session references and terminal content at the decoding boundary.
export const Snapshot = Schema.Struct({
  version: Schema.String,
  protocol: Schema.Int,
  workspaces: Schema.Array(Schema.Struct({ workspace_id: Schema.String })),
  tabs: Schema.Array(Schema.Struct({ tab_id: Schema.String, workspace_id: Schema.String })),
  panes: Schema.Array(Schema.Struct({ pane_id: Schema.String, terminal_id: Schema.String })),
  layouts: Schema.Array(Schema.Struct({ workspace_id: Schema.String, tab_id: Schema.String })),
  agents: Schema.Array(Schema.Struct({ terminal_id: Schema.String, pane_id: Schema.String })),
});
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export interface Options {
  readonly socketPath: string;
}

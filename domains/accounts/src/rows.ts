import { connections, deviceLogins, forwards } from "@notus/db/schema/connection";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import type * as Schema from "effect/Schema";

export const ConnectionRow = createSelectSchema(connections);
export interface ConnectionRow extends Schema.Schema.Type<typeof ConnectionRow> {}
export const DeviceLoginRow = createSelectSchema(deviceLogins);
export interface DeviceLoginRow extends Schema.Schema.Type<typeof DeviceLoginRow> {}
export const ForwardRow = createSelectSchema(forwards);
export interface ForwardRow extends Schema.Schema.Type<typeof ForwardRow> {}

import { Actor } from "@notus/contracts/source";
import * as Schema from "effect/Schema";

export const Fixture = Schema.Struct({ actor: Actor, userId: Schema.NonEmptyString });
export interface Fixture extends Schema.Schema.Type<typeof Fixture> {}

import * as Schema from "effect/Schema";

export class Failure extends Schema.TaggedError<Failure>()("Herdr.Failure", {
  reason: Schema.Literals([
    "connect",
    "eof",
    "frame",
    "response",
    "remote",
    "timeout",
    "incompatible",
  ]),
}) {}

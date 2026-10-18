import { deliveries, events, inputs, responses, sources, tasks } from "@notus/db/schema/task";
import { Input, Reservation } from "@notus/platform/source";
import { Mode } from "@notus/executions/types";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Schema from "effect/Schema";
import { Attachment, DeliveryOutcome } from "./types";

/** Decoders from stored rows to the task's own types. */
export const TaskRow = createSelectSchema(tasks, { reservation: Reservation, mode: Mode });
export const SourceRow = createSelectSchema(sources, { attachment: Attachment });
export const InputRow = createSelectSchema(inputs, { input: Input });
export const ResponseRow = createSelectSchema(responses);
export const DeliveryRow = createSelectSchema(deliveries, {
  outcome: Schema.NullOr(DeliveryOutcome),
});
export const EventRow = createSelectSchema(events);

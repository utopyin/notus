import { BOAT_DESCRIPTOR } from "@notus/compute/descriptors/index";
import type { Kit } from "../kit";
import { configOf, fieldsOf, labelOf, problemOf, type Fields } from "./fields";
import { BoatForm } from "./form";
import { BoatMark } from "./mark";

/** The adapter's own rule, repeated so the page can say so before saving. */
const templatePattern = /^(?:bsh_[A-Za-z0-9_-]{1,128}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

export const boatKit: Kit<Fields> = {
  descriptor: BOAT_DESCRIPTOR,
  Mark: BoatMark,
  Form: BoatForm,
  fieldsOf,
  configOf,
  problemOf,
  templateOf: (fields) => fields.template,
  withTemplate: (fields, template) => ({ ...fields, template }),
  labelOf,
  shortTemplate: (ref) => ref,
  templateProblem: (ref) =>
    templatePattern.test(ref)
      ? null
      : "A snapshot is the name it was saved under, or a share code starting bsh_.",
  credentialOf: (apiKey) => ({ apiKey }),
};

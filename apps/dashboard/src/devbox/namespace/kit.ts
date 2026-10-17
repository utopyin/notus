import { NAMESPACE_DESCRIPTOR } from "@notus/compute/descriptors/index";
import { imageRefPattern } from "@notus/namespace/restricted";
import type { Kit } from "../kit";
import { configOf, fieldsOf, labelOf, problemOf, shortValue, type Fields } from "./fields";
import { NamespaceForm } from "./form";
import { NamespaceMark } from "./mark";

export const namespaceKit: Kit<Fields> = {
  descriptor: NAMESPACE_DESCRIPTOR,
  Mark: NamespaceMark,
  Form: NamespaceForm,
  fieldsOf,
  configOf,
  problemOf,
  templateOf: (fields) => fields.imageRef,
  withTemplate: (fields, imageRef) => ({ ...fields, imageRef }),
  labelOf,
  shortTemplate: shortValue,
  templateProblem: (ref) =>
    imageRefPattern.test(ref)
      ? null
      : "A reference is registry/repository@sha256:digest, with no tag.",
  credentialOf: (token) => ({ token }),
};

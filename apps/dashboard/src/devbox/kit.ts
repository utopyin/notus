import type { ProviderDescriptor } from "@notus/compute/descriptor";
import type { Provider } from "@notus/compute/provider";
import type { FC } from "react";
import { isObject, type Json } from "../lib/json";
import { boatKit } from "./boat/kit";
import { namespaceKit } from "./namespace/kit";

/**
 * What the Devbox page needs from one provider: its native form, and the few words and shapes
 * that differ. Everything else on the page (the account card, the templates, saving and the
 * history) is the same for every provider. `F` is the form's own editable state.
 */
export interface Kit<F> {
  readonly descriptor: ProviderDescriptor;
  readonly Mark: FC<{ className?: string }>;
  readonly Form: FC<{
    fields: F;
    templates: ReadonlyArray<string>;
    disabled: boolean;
    onChange: (change: Partial<F>) => void;
  }>;
  readonly fieldsOf: (config: Json | null | undefined) => F;
  /** The document the fields describe, which the provider's adapter validates on save. */
  readonly configOf: (fields: F) => Json;
  /** What keeps the form from saving, in the words the field shows; null when nothing does. */
  readonly problemOf: (fields: F) => string | null;
  /** The template the fields select; empty for none. */
  readonly templateOf: (fields: F) => string;
  readonly withTemplate: (fields: F, ref: string) => F;
  /** How a document path reads in the history. */
  readonly labelOf: (path: string) => string;
  /** A template reference short enough for a list. */
  readonly shortTemplate: (ref: string) => string;
  /** Null when the reference has the provider's shape; otherwise what is wrong with it. */
  readonly templateProblem: (ref: string) => string | null;
  /** The account JSON the adapter checks, from what the admin pasted. */
  readonly credentialOf: (secret: string) => Json;
}

/** A kit whose form state is hidden, so kits of different providers share one table. */
export type AnyKit = <R>(use: <F>(kit: Kit<F>) => R) => R;
export const anyKit =
  <F>(kit: Kit<F>): AnyKit =>
  (use) =>
    use(kit);

/** Total over the vocabulary: a provider without a kit does not compile. */
export const KITS: { readonly [P in Provider]: AnyKit } = {
  namespace: anyKit(namespaceKit),
  boat: anyKit(boatKit),
};

export interface Change {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}
/** Every leaf of the document, by path. Lists of strings stay one leaf so they diff as a whole. */
const leaves = (
  value: Json | undefined,
  prefix: string,
  into: Map<string, string>,
  short: (value: string) => string,
) => {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) into.set(prefix, value.join(", "));
    else
      value.forEach((item, index) =>
        leaves(item, prefix ? `${prefix}.${index}` : `${index}`, into, short),
      );
  } else if (isObject(value)) {
    for (const key of Object.keys(value).sort())
      leaves(value[key], prefix ? `${prefix}.${key}` : key, into, short);
  } else if (value !== undefined) {
    into.set(prefix, typeof value === "string" ? short(value) : JSON.stringify(value));
  }
};
/** What one document changed against the one before it. */
export const changes = (
  before: Json | undefined,
  after: Json | undefined,
  short: (value: string) => string,
): ReadonlyArray<Change> => {
  const from = new Map<string, string>();
  const to = new Map<string, string>();
  leaves(before, "", from, short);
  leaves(after, "", to, short);
  const paths = [...new Set([...from.keys(), ...to.keys()])].sort();
  return paths
    .filter((path) => from.get(path) !== to.get(path))
    .map((path) => ({ path, before: from.get(path) ?? null, after: to.get(path) ?? null }));
};

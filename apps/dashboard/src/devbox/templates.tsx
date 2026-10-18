import type { ProviderDescriptor } from "@notus/compute/descriptor";
import { IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type FC } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "../query";
import type { EnvironmentView } from "../server/devbox";

type Template = EnvironmentView["workspaceImages"][number];
type Build = NonNullable<EnvironmentView["build"]>;

/** How often the page looks again while a build runs; one takes a few minutes. */
const buildPollMs = 10_000;

/**
 * The Notus template Notus builds in the workspace's own account, on providers that let it: what
 * the last build did, and a button for admins to build it again. While one runs, the page reloads
 * until it ends.
 */
export const TemplateBuild: FC<{
  descriptor: ProviderDescriptor;
  workspaceId: string;
  build: Build | null;
  connected: boolean;
  disabled: boolean;
  onBuild: () => Promise<string | null>;
  onPoll: () => Promise<void>;
}> = ({ descriptor, workspaceId, build, connected, disabled, onBuild, onPoll }) => {
  const noun = descriptor.template.noun;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const building = build?.status === "building";
  // The page reloads on the poll itself; nothing is read from the query.
  useQuery(
    {
      queryKey: ["template-build", workspaceId, descriptor.provider],
      queryFn: async () => {
        await onPoll();
        return Date.now();
      },
      enabled: building,
      initialData: 0,
      initialDataUpdatedAt: Date.now,
      staleTime: Infinity,
      refetchInterval: buildPollMs,
    },
    queryClient,
  );
  const status =
    build === null
      ? connected
        ? `Notus has not built its ${noun.one} in this account yet.`
        : `Once the account is connected, Notus builds its ${noun.one} in it.`
      : build.status === "building"
        ? `Building the Notus ${noun.one} in your ${descriptor.name} account. This takes a few minutes.`
        : build.status === "ready"
          ? `The Notus ${noun.one} ${build.ref ?? ""} was built ${when(build.finishedAt ?? build.startedAt)}.`
          : `The last build failed: ${build.reason ?? "no reason given"}`;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={build?.status === "failed" ? "text-destructive flex-1" : "flex-1"}>
        {status}
        {message ? <span className="text-destructive block">{message}</span> : null}
      </span>
      {disabled || !connected ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || building}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setMessage(await onBuild());
            setBusy(false);
          }}
        >
          {building ? "Building" : build === null ? "Build" : "Rebuild"}
        </Button>
      )}
    </div>
  );
};

const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The workspace's templates for one provider: the references its admins added, the only ones it
 * may launch. On Namespace an admin builds an image from the Notus base, publishes it and adds its
 * digest. One may be the default, which a new configuration starts from; the provider may infer
 * one, such as the only image.
 */
export const WorkspaceTemplates: FC<{
  descriptor: ProviderDescriptor;
  short: (ref: string) => string;
  problemOf: (ref: string) => string | null;
  images: ReadonlyArray<Template>;
  selected: string;
  /** The saved default or the inferred one; only a saved one can be cleared. */
  defaultRef: string | null;
  disabled: boolean;
  nameOf: (userId: string) => string;
  onAdd: (ref: string, label: string) => Promise<string | null>;
  onRemove: (ref: string) => Promise<string | null>;
  onDefault: (ref: string | null) => Promise<string | null>;
}> = ({
  descriptor,
  short: shortValue,
  problemOf,
  images,
  selected,
  defaultRef,
  disabled,
  nameOf,
  onAdd,
  onRemove,
  onDefault,
}) => {
  const noun = descriptor.template.noun;
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const value = ref.trim();
  const problem = value === "" ? null : problemOf(value);
  const valid = value !== "" && problem === null;
  const run = async (work: () => Promise<string | null>, done?: () => void) => {
    if (busy) return;
    setBusy(true);
    const problem = await work();
    setBusy(false);
    setMessage(problem);
    if (problem === null) done?.();
  };
  return (
    <div className="flex flex-col gap-4">
      {images.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {noun.one} of your own yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {images.map((image) => (
            <li key={image.ref} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {image.label || shortValue(image.ref)}
                  {image.ref === selected ? (
                    <span className="text-muted-foreground font-normal"> (selected)</span>
                  ) : null}
                  {image.ref === defaultRef ? (
                    <span className="text-muted-foreground font-normal">
                      {image.isDefault ? " (default)" : ` (default, as the only ${noun.one})`}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground block truncate text-xs" title={image.ref}>
                  {shortValue(image.ref)}, added by {nameOf(image.addedBy)}
                </span>
              </span>
              {disabled ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => onDefault(image.isDefault ? null : image.ref))}
                >
                  {image.isDefault ? "Clear default" : "Make default"}
                </Button>
              )}
              {disabled ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${image.label || shortValue(image.ref)}`}
                  disabled={busy}
                  onClick={() => run(() => onRemove(image.ref))}
                >
                  <IconX className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {disabled ? null : (
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void run(
              () => onAdd(value, label.trim()),
              () => {
                setRef("");
                setLabel("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="image-ref">Reference</Label>
            <Input
              id="image-ref"
              value={ref}
              placeholder={descriptor.template.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setRef(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="image-label">Label</Label>
            <Input
              id="image-label"
              value={label}
              maxLength={80}
              placeholder="Optional"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || !valid}>
            Add
          </Button>
        </form>
      )}
      {problem ? <p className="text-muted-foreground text-xs">{problem}</p> : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </div>
  );
};

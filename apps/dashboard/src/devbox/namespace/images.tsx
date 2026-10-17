import { IconX } from "@tabler/icons-react";
import { imageRefPattern } from "@notus/namespace/restricted";
import { useState, type FC } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnvironmentView } from "../../server/devbox";
import { shortValue } from "./fields";

type Image = EnvironmentView["workspaceImages"][number];

/**
 * The workspace's images: the references its admins approved, the only ones it may launch. An admin
 * builds from the Notus base, publishes the image, and adds its digest here. One may be the
 * default, which a new configuration starts from; with a single image, that one is inferred.
 */
export const WorkspaceImages: FC<{
  images: ReadonlyArray<Image>;
  selected: string;
  /** The saved default or the inferred one; only a saved one can be cleared. */
  defaultRef: string | null;
  disabled: boolean;
  nameOf: (userId: string) => string;
  onAdd: (ref: string, label: string) => Promise<string | null>;
  onRemove: (ref: string) => Promise<string | null>;
  onDefault: (ref: string | null) => Promise<string | null>;
}> = ({ images, selected, defaultRef, disabled, nameOf, onAdd, onRemove, onDefault }) => {
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const value = ref.trim();
  const valid = imageRefPattern.test(value);
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
        <p className="text-muted-foreground text-sm">No image of your own yet.</p>
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
                      {image.isDefault ? " (default)" : " (default, as the only image)"}
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
            <Label htmlFor="image-ref">Image reference</Label>
            <Input
              id="image-ref"
              value={ref}
              placeholder="nscr.io/tenant/name@sha256:…"
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
      {value !== "" && !valid ? (
        <p className="text-muted-foreground text-xs">
          A reference is registry/repository@sha256:digest, with no tag.
        </p>
      ) : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </div>
  );
};

import { IconPlus, IconX } from "@tabler/icons-react";
import { architectures, environmentNames } from "@notus/namespace/restricted";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, Section } from "../field";
import { shortValue, type Egress, type Fields } from "./fields";

/** Selects carry no empty value, so "provider default" is a value of its own. */
const DEFAULT = "default";
const egressItems: ReadonlyArray<{ value: Egress; label: string }> = [
  { value: "unrestricted", label: "Unrestricted" },
  { value: "allowed", label: "Allowed domains only" },
  { value: "policy", label: "A named policy" },
];
const architectureItems = [
  { value: DEFAULT, label: "Provider default" },
  ...architectures.map((value) => ({ value, label: value })),
];
const enforcementItems = [
  { value: "enforced", label: "Enforced" },
  { value: "advisory", label: "Advisory: logged, not blocked" },
];

/**
 * The Namespace configuration as fields. Every value the restricted policy accepts has a field
 * here; the image can only be one the workspace added. Nothing is validated beyond what the
 * fields themselves say: the policy on the API has the last word and its message is shown.
 */
export const NamespaceForm: FC<{
  fields: Fields;
  templates: ReadonlyArray<string>;
  disabled: boolean;
  onChange: (change: Partial<Fields>) => void;
}> = ({ fields, templates: approvedImages, disabled, onChange }) => {
  // Only the workspace's images can be selected; a stored one that was removed still shows.
  const imageApproved = approvedImages.includes(fields.imageRef);
  const imageItems = [
    ...approvedImages.map((value) => ({ value, label: shortValue(value) })),
    ...(fields.imageRef && !imageApproved
      ? [{ value: fields.imageRef, label: `${shortValue(fields.imageRef)} (no longer approved)` }]
      : []),
  ];
  const unusedNames = environmentNames.filter(
    (name) => !fields.variables.some((item) => item.name === name),
  );
  const setVariable = (index: number, change: Partial<{ name: string; value: string }>) =>
    onChange({
      variables: fields.variables.map((item, i) => (i === index ? { ...item, ...change } : item)),
    });
  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Image"
        description="What the devbox boots from. Only images this workspace added can be selected."
      >
        <div className="sm:col-span-2">
          <Field
            id="image"
            label="Image"
            hint={
              fields.imageRef
                ? fields.imageRef
                : "This workspace has no image yet, so no devbox can start. Add one below."
            }
          >
            <Select
              items={imageItems}
              value={fields.imageRef || null}
              disabled={disabled || imageItems.length === 0}
              onValueChange={(value) => {
                if (typeof value === "string") onChange({ imageRef: value });
              }}
            >
              <SelectTrigger id="image" className="font-mono">
                <SelectValue placeholder="No image approved" />
              </SelectTrigger>
              <SelectContent>
                {imageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="font-mono">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {fields.imageRef && !imageApproved ? (
            <p className="text-muted-foreground mt-2 text-xs">
              This image is no longer one of the workspace's. No task can start until another is
              selected.
            </p>
          ) : null}
        </div>
      </Section>
      <Section title="Machine" description="Blank fields leave the provider's defaults in place.">
        <Field id="site" label="Region" hint="A Namespace site, like iad.">
          <Input
            id="site"
            value={fields.site}
            disabled={disabled}
            placeholder="iad"
            onChange={(event) => onChange({ site: event.target.value })}
          />
        </Field>
        <Field id="arch" label="Architecture">
          <Select
            items={architectureItems}
            value={fields.machineArch || DEFAULT}
            disabled={disabled}
            onValueChange={(value) => {
              onChange({
                machineArch: value === "amd64" || value === "arm64" ? value : "",
              });
            }}
          >
            <SelectTrigger id="arch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {architectureItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="cpu" label="vCPUs">
          <Input
            id="cpu"
            inputMode="numeric"
            value={fields.virtualCpu}
            disabled={disabled}
            placeholder="4"
            onChange={(event) => onChange({ virtualCpu: event.target.value })}
          />
        </Field>
        <Field id="memory" label="Memory (MB)">
          <Input
            id="memory"
            inputMode="numeric"
            value={fields.memoryMegabytes}
            disabled={disabled}
            placeholder="8192"
            onChange={(event) => onChange({ memoryMegabytes: event.target.value })}
          />
        </Field>
      </Section>
      <Section title="Storage">
        <Field id="volume" label="Volume (GB)" hint="The working disk.">
          <Input
            id="volume"
            inputMode="numeric"
            value={fields.volumeSizeGb}
            disabled={disabled}
            onChange={(event) => onChange({ volumeSizeGb: event.target.value })}
          />
        </Field>
        <Field
          id="cache"
          label="Cache volume (GB)"
          hint="Kept between devboxes for package caches."
        >
          <Input
            id="cache"
            inputMode="numeric"
            value={fields.cacheVolumeSizeGb}
            disabled={disabled}
            onChange={(event) => onChange({ cacheVolumeSizeGb: event.target.value })}
          />
        </Field>
      </Section>
      <Section title="Lifetime">
        <Field
          id="busy"
          label="Minimum busy time (seconds)"
          hint="How long the devbox is kept busy after it starts, whatever happens."
        >
          <Input
            id="busy"
            inputMode="numeric"
            value={fields.busyMinimumSeconds}
            disabled={disabled}
            onChange={(event) => onChange({ busyMinimumSeconds: event.target.value })}
          />
        </Field>
        <Field
          id="retention"
          label="Stopped retention (seconds)"
          hint="How long a stopped devbox is kept before it is destroyed."
        >
          <Input
            id="retention"
            inputMode="numeric"
            value={fields.stoppedRetentionSeconds}
            disabled={disabled}
            onChange={(event) => onChange({ stoppedRetentionSeconds: event.target.value })}
          />
        </Field>
      </Section>
      <Section title="Network" description="Where the devbox may connect to.">
        <Field id="egress" label="Egress">
          <Select
            items={egressItems}
            value={fields.egress}
            disabled={disabled}
            onValueChange={(value) => {
              if (value === "unrestricted" || value === "allowed" || value === "policy")
                onChange({ egress: value });
            }}
          >
            <SelectTrigger id="egress">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {egressItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {fields.egress === "allowed" ? (
          <>
            <Field id="enforcement" label="Enforcement">
              <Select
                items={enforcementItems}
                value={fields.advisory ? "advisory" : "enforced"}
                disabled={disabled}
                onValueChange={(value) => onChange({ advisory: value === "advisory" })}
              >
                <SelectTrigger id="enforcement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enforcementItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field id="domains" label="Allowed domains" hint="One per line.">
                <Textarea
                  id="domains"
                  rows={4}
                  value={fields.allowedDomains}
                  disabled={disabled}
                  placeholder={"github.com\nregistry.npmjs.org"}
                  onChange={(event) => onChange({ allowedDomains: event.target.value })}
                />
              </Field>
            </div>
          </>
        ) : null}
        {fields.egress === "policy" ? (
          <Field id="policy" label="Policy tag" hint="A network policy defined in Namespace.">
            <Input
              id="policy"
              value={fields.policyTag}
              disabled={disabled}
              onChange={(event) => onChange({ policyTag: event.target.value })}
            />
          </Field>
        ) : null}
      </Section>
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Environment variables</h3>
          <p className="text-muted-foreground text-xs">
            Locale, time zone and terminal hints. Anything that could change what runs is not
            settable here.
          </p>
        </div>
        {fields.variables.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {fields.variables.map((item, index) => {
              const nameItems = environmentNames
                .filter((name) => name === item.name || unusedNames.includes(name))
                .map((name) => ({ value: name, label: name }));
              return (
                <li
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2"
                >
                  <Select
                    items={nameItems}
                    value={item.name || null}
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (typeof value === "string") setVariable(index, { name: value });
                    }}
                  >
                    <SelectTrigger aria-label="Variable name" className="font-mono">
                      <SelectValue placeholder="Name" />
                    </SelectTrigger>
                    <SelectContent>
                      {nameItems.map((name) => (
                        <SelectItem key={name.value} value={name.value} className="font-mono">
                          {name.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="Variable value"
                    className="font-mono"
                    value={item.value}
                    disabled={disabled}
                    maxLength={256}
                    onChange={(event) => setVariable(index, { value: event.target.value })}
                  />
                  {disabled ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove variable"
                      onClick={() =>
                        onChange({ variables: fields.variables.filter((_, i) => i !== index) })
                      }
                    >
                      <IconX className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {disabled ? (
          fields.variables.length === 0 ? (
            <p className="text-muted-foreground text-sm">None set.</p>
          ) : null
        ) : (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={unusedNames.length === 0}
              onClick={() =>
                onChange({ variables: [...fields.variables, { name: "", value: "" }] })
              }
            >
              <IconPlus className="size-4" />
              Add variable
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

import type { FC } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, Section } from "../field";
import { machineTypes, type Fields } from "./fields";

/** Selects carry no empty value, so "default" is a value of its own. */
const DEFAULT = "default-choice";

/**
 * The Boat configuration as fields: the named snapshot a box starts from, its size and Boat's
 * auto-stop deadline. A refusal on save shows the adapter's message.
 */
export const BoatForm: FC<{
  fields: Fields;
  templates: ReadonlyArray<string>;
  disabled: boolean;
  onChange: (change: Partial<Fields>) => void;
}> = ({ fields, templates, disabled, onChange }) => {
  const listed = fields.template === "" || templates.includes(fields.template);
  const templateItems = [
    { value: DEFAULT, label: "The workspace default" },
    ...templates.map((value) => ({ value, label: value })),
    ...(listed ? [] : [{ value: fields.template, label: `${fields.template} (no longer added)` }]),
  ];
  const typeItems = [
    { value: DEFAULT, label: "The snapshot's own size" },
    ...machineTypes.map((value) => ({ value, label: value })),
  ];
  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Snapshot"
        description="What the devbox starts from. Only snapshots this workspace added can be selected."
      >
        <div className="sm:col-span-2">
          <Field
            id="template"
            label="Snapshot"
            hint={
              templates.length === 0
                ? "This workspace has no snapshot yet, so no devbox can start. Add one below."
                : listed
                  ? undefined
                  : "This snapshot is no longer one of the workspace's. No task can start until another is selected."
            }
          >
            <Select
              items={templateItems}
              value={fields.template || DEFAULT}
              disabled={disabled || templates.length === 0}
              onValueChange={(value) => {
                if (typeof value === "string")
                  onChange({ template: value === DEFAULT ? "" : value });
              }}
            >
              <SelectTrigger id="template" className="font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templateItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="font-mono">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>
      <Section title="Machine" description="Blank fields keep what the snapshot was saved with.">
        <Field id="type" label="Size" hint="large and xlarge need a paid Boat plan.">
          <Select
            items={typeItems}
            value={fields.type || DEFAULT}
            disabled={disabled}
            onValueChange={(value) => {
              if (typeof value === "string")
                onChange({ type: machineTypes.find((type) => type === value) ?? "" });
            }}
          >
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="auto-stop"
          label="Auto-stop (minutes)"
          hint="Boat stops the box once it has been idle this long; Notus holds it awake while a command runs. Blank is Boat's hour; off never stops it, and Boat bills while it runs."
        >
          <Input
            id="auto-stop"
            value={fields.autoStop}
            disabled={disabled}
            placeholder="60"
            onChange={(event) => onChange({ autoStop: event.target.value })}
          />
        </Field>
      </Section>
    </div>
  );
};

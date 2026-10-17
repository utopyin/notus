import type { FC, ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** A labelled field; the hint sits under the control. */
export const Field: FC<{ id: string; label: string; hint?: string; children: ReactNode }> = ({
  id,
  label,
  hint,
  children,
}) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
  </div>
);

export const Section: FC<{ title: string; description?: string; children: ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="flex flex-col gap-4">
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </section>
);

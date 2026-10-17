import type { ProviderDescriptor } from "@notus/compute/descriptor";
import { useState, type FC } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Json } from "../lib/json";
import type { EnvironmentView } from "../server/devbox";

type Connection = NonNullable<EnvironmentView["connection"]>;

/**
 * The workspace's own account with one provider. Members see whether one is connected; admins
 * paste its secret to connect or replace it. The secret goes in once and is never shown again.
 */
export const ComputeConnection: FC<{
  descriptor: ProviderDescriptor;
  credentialOf: (secret: string) => Json;
  connected: Connection | null;
  disabled: boolean;
  nameOf: (userId: string) => string;
  when: (millis: number) => string;
  onConnect: (credential: Json, label: string) => Promise<string | null>;
  onDisconnect: () => Promise<string | null>;
}> = ({ descriptor, credentialOf, connected, disabled, nameOf, when, onConnect, onDisconnect }) => {
  const connection = descriptor.connection;
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const value = token.trim();
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
      {connected ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{connected.label || "Connected"}</span>
            <span className="text-muted-foreground block truncate text-xs">
              Connected by {nameOf(connected.connectedBy)}, {when(connected.connectedAt)}
            </span>
          </span>
          {disabled ? null : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(onDisconnect)}>
              Disconnect
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Not connected. Tasks cannot start a devbox until an admin connects one.
        </p>
      )}
      {disabled ? null : (
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (value === "") return;
            void run(
              () => onConnect(credentialOf(value), label.trim()),
              () => {
                setToken("");
                setLabel("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compute-token">
              {connected ? `Replace ${connection.label.toLowerCase()}` : connection.label}
            </Label>
            <Input
              id="compute-token"
              type="password"
              value={token}
              placeholder={connection.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compute-label">Label</Label>
            <Input
              id="compute-label"
              value={label}
              maxLength={80}
              placeholder="Optional, such as the account's name"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || value === ""}>
            {connected ? "Replace" : "Connect"}
          </Button>
        </form>
      )}
      {disabled ? null : <p className="text-muted-foreground text-xs">{connection.help}</p>}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </div>
  );
};

import {
  IconBrandGithub,
  IconBrandOpenai,
  IconBrandSlack,
  IconDeviceLaptop,
  IconExternalLink,
  IconKeyFilled,
  IconLinkOff,
  IconLink,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { authClient, type Provider } from "../auth-client";
import { queryClient } from "../query";
import {
  beginChatGpt,
  getConnections,
  linkApiKey,
  pollChatGpt,
  revokeConnection,
  type Connection,
} from "../server/connections";
import { getSessions } from "../server/me";

const root = getRouteApi("__root__");

/** Workspace-less: the signed-in person's identities and sessions. */
export const Route = createFileRoute("/account")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/sign-in" });
    const [sessions, connections] = await Promise.all([getSessions(), getConnections()]);
    return { sessions, connections };
  },
  component: Account,
});

/** A short "Chrome on macOS" label; the full user agent is not useful to read. */
const clientOf = (userAgent: string | null | undefined) => {
  if (!userAgent) return "Unknown client";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
};

function Account() {
  const me = root.useLoaderData();
  const router = useRouter();
  const { sessions, connections } = Route.useLoaderData();
  const [message, setMessage] = useState<string | null>(null);
  const [linking, setLinking] = useState<Provider | null>(null);
  if (!me) return null;
  const linked = (provider: string) => me.accounts.find((a) => a.provider === provider);
  const link = async (provider: Provider) => {
    if (linking) return;
    setLinking(provider);
    const { error } = await authClient.linkSocial({ provider, callbackURL: "/account" });
    if (error) {
      setMessage(error.message ?? "Linking failed.");
      setLinking(null);
    }
  };
  const unlink = async (accountId: string) => {
    const { error } = await authClient.unlinkAccount({ accountId });
    if (error) setMessage(error.message ?? "Unlinking failed.");
    else await router.invalidate();
  };
  const revoke = async (token: string) => {
    await authClient.revokeSession({ token });
    await router.invalidate();
  };
  const providers = [
    { id: "slack" as const, label: "Slack", icon: IconBrandSlack },
    { id: "github" as const, label: "GitHub", icon: IconBrandGithub },
  ];
  return (
    <AppShell
      me={me}
      current={me.workspaces[0] ?? null}
      active="account"
      title="Account"
      description={me.user.email}
    >
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Identities</h2>
        <ul className="bg-card divide-y divide-foreground/10 rounded-lg ring-1 ring-foreground/10">
          {providers.map((provider) => {
            const account = linked(provider.id);
            return (
              <li key={provider.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <provider.icon className="text-muted-foreground size-5" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{provider.label}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {account
                      ? `${account.accountId}${provider.id === "slack" && me.user.slackTeamId ? ` · team ${me.user.slackTeamId}` : ""}`
                      : "Not linked"}
                  </span>
                </div>
                {account ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={me.accounts.length < 2}
                      onClick={() => unlink(account.id)}
                    >
                      <IconLinkOff className="size-4" />
                      Unlink
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linking !== null}
                    onClick={() => link(provider.id)}
                  >
                    <IconLink className="size-4" />
                    {linking === provider.id ? "Redirecting…" : "Link"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {message ? <p className="text-destructive text-sm">{message}</p> : null}
      </section>
      <ModelConnections connections={connections} />
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sessions</h2>
        <ul className="bg-card divide-y divide-foreground/10 rounded-lg ring-1 ring-foreground/10">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <IconDeviceLaptop className="text-muted-foreground size-5" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {clientOf(session.userAgent)}
                  {session.current ? (
                    <span className="text-muted-foreground"> · this session</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  since {new Date(session.createdAt).toLocaleString()}
                </span>
              </div>
              {session.current ? null : (
                <Button variant="ghost" size="sm" onClick={() => revoke(session.token)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

const whenOf = (millis: number | null) =>
  millis === null ? null : new Date(millis).toLocaleString();

/**
 * The user's own model accounts. A ChatGPT subscription serves Codex on the dev box; a platform
 * API key serves the operator, which runs on Cloudflare where the subscription backend is
 * unreachable. Nothing here ever shows a token: status, the account, when it was linked or rotated.
 */
function ModelConnections(props: { connections: ReadonlyArray<Connection> }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [key, setKey] = useState("");
  const [linkingKey, setLinkingKey] = useState(false);
  // An outcome the server confirmed, pinned to the connections it was confirmed against. It
  // stands in for them until the router commits a fresh load, which replaces the array; that is
  // the moment the row may show real data again, so it never shows the previous state between.
  const [transition, setTransition] = useState<{
    readonly provider: Connection["provider"];
    readonly outcome: "linked" | "unlinked";
    readonly from: ReadonlyArray<Connection>;
  } | null>(null);
  const active = transition !== null && transition.from === props.connections ? transition : null;
  const connecting = (provider: Connection["provider"]) =>
    active?.provider === provider && active.outcome === "linked";
  const disconnecting = (provider: Connection["provider"]) =>
    active?.provider === provider && active.outcome === "unlinked";
  const settle = (provider: Connection["provider"], outcome: "linked" | "unlinked") => {
    setTransition({ provider, outcome, from: props.connections });
    return router.invalidate().catch(() => setTransition(null));
  };
  const chatgpt = props.connections.find((c) => c.provider === "openai-chatgpt") ?? null;
  const apiKey = props.connections.find((c) => c.provider === "openai-api") ?? null;
  // A started device login is polled at the issuer's pace until it is linked or expires; the
  // outcome is handled where it arrives, in the poll itself, never in render.
  const device = useQuery(
    {
      queryKey: ["chatgpt-device-login"],
      queryFn: async () => {
        const result = await pollChatGpt();
        if (result.ok && result.value.state !== "pending") {
          setStarting(false);
          if (result.value.state === "linked") await settle("openai-chatgpt", "linked");
          else setMessage("The code expired before it was used; start again.");
        }
        return result;
      },
      enabled: starting,
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.ok && data.value.state === "pending" ? data.value.interval * 1000 : false;
      },
    },
    queryClient,
  );
  const pending =
    starting && device.data?.ok && device.data.value.state === "pending" ? device.data.value : null;
  const connectChatGpt = async () => {
    setMessage(null);
    setRequesting(true);
    const result = await beginChatGpt();
    setRequesting(false);
    if (!result.ok) return setMessage(`That did not work (${result.reason}).`);
    queryClient.setQueryData(["chatgpt-device-login"], { ok: true, value: result.value });
    setStarting(true);
  };
  const connectKey = async () => {
    setMessage(null);
    setLinkingKey(true);
    const result = await linkApiKey({ data: { key } });
    setLinkingKey(false);
    if (!result.ok)
      return setMessage(
        result.reason === "invalid-input"
          ? "That does not look like a platform API key."
          : `That did not work (${result.reason}).`,
      );
    setKey("");
    await settle("openai-api", "linked");
  };
  const disconnect = async (provider: Connection["provider"]) => {
    setTransition({ provider, outcome: "unlinked", from: props.connections });
    const result = await revokeConnection({ data: { provider } });
    if (!result.ok) {
      setTransition(null);
      return setMessage(`That did not work (${result.reason}).`);
    }
    await settle(provider, "unlinked");
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Model connections</h2>
      <ul className="bg-card divide-y divide-foreground/10 rounded-lg ring-1 ring-foreground/10">
        <li className="flex flex-col gap-3 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <IconBrandOpenai className="text-muted-foreground size-5" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">ChatGPT</span>
              <span className="text-muted-foreground truncate text-xs">
                {connecting("openai-chatgpt")
                  ? "Connecting your ChatGPT account…"
                  : disconnecting("openai-chatgpt")
                    ? "Disconnecting…"
                    : chatgpt?.linked
                      ? `Connected · linked ${whenOf(chatgpt.linkedAt)}${chatgpt.rotatedAt === null ? "" : ` · refreshed ${whenOf(chatgpt.rotatedAt)}`}`
                      : "Not connected. Runs Codex on the dev box with your subscription."}
              </span>
            </div>
            {chatgpt?.linked ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={active !== null}
                onClick={() => disconnect("openai-chatgpt")}
              >
                <IconLinkOff className="size-4" />
                {disconnecting("openai-chatgpt") ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : pending === null ? (
              <Button
                size="sm"
                variant="outline"
                disabled={starting || requesting || active !== null}
                onClick={connectChatGpt}
              >
                <IconLink className="size-4" />
                {connecting("openai-chatgpt")
                  ? "Connecting…"
                  : requesting
                    ? "Requesting a code…"
                    : "Sign in with ChatGPT"}
              </Button>
            ) : null}
          </div>
          {pending ? (
            <div className="flex flex-col items-center gap-4 rounded-lg px-4 py-6 ring-1 ring-foreground/10">
              <p className="text-muted-foreground text-center text-xs text-pretty">
                Open the verification page and enter this one-time code. It expires in{" "}
                {Math.max(1, Math.ceil((pending.expiresAt - Date.now()) / 60_000))} minutes.
              </p>
              {/* The code is the thing to carry over; clicking it copies it. */}
              <button
                type="button"
                className="rounded-md px-4 py-3 font-mono text-2xl font-medium tracking-[0.3em] transition-colors hover:bg-accent"
                title="Copy"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(pending.userCode)
                    .then(() =>
                      toast.add({ type: "success", title: "Code copied", timeout: 2000 }),
                    );
                }}
              >
                {pending.userCode}
              </button>
              <Button
                variant="outline"
                render={<a href={pending.verificationUrl} target="_blank" rel="noreferrer" />}
              >
                <IconExternalLink className="size-4" />
                Open verification page
              </Button>
            </div>
          ) : null}
        </li>
        <li className="flex flex-col gap-3 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <IconKeyFilled className="text-muted-foreground size-5" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">OpenAI API key</span>
              <span className="text-muted-foreground truncate text-xs">
                {connecting("openai-api")
                  ? "Connecting…"
                  : disconnecting("openai-api")
                    ? "Disconnecting…"
                    : apiKey?.linked
                      ? `Linked ${whenOf(apiKey.linkedAt)}`
                      : "Not connected. Runs the operator on the platform API backend."}
              </span>
            </div>
            {apiKey?.linked ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={active !== null}
                onClick={() => disconnect("openai-api")}
              >
                <IconLinkOff className="size-4" />
                {disconnecting("openai-api") ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : null}
          </div>
          {apiKey?.linked ? null : (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void connectKey();
              }}
            >
              <Input
                className="font-mono"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={linkingKey || active !== null || !key.trim()}
              >
                <IconLink className="size-4" />
                {linkingKey || connecting("openai-api") ? "Connecting…" : "Connect"}
              </Button>
            </form>
          )}
        </li>
      </ul>
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </section>
  );
}

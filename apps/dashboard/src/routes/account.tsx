import {
  IconBrandGithub,
  IconBrandSlack,
  IconDeviceLaptop,
  IconLinkOff,
  IconLink,
} from "@tabler/icons-react";
import { createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { authClient, type Provider } from "../auth-client";

const root = getRouteApi("__root__");

/** Workspace-less: the signed-in person's identities and sessions. */
export const Route = createFileRoute("/account")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/sign-in" });
  },
  component: Account,
});

type Session = { id: string; token: string; createdAt: Date | string; userAgent?: string | null };
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
  const [sessions, setSessions] = useState<ReadonlyArray<Session>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [linking, setLinking] = useState<Provider | null>(null);
  const reloadSessions = async () => {
    const { data } = await authClient.listSessions();
    setSessions(data ?? []);
  };
  useEffect(() => {
    void reloadSessions();
  }, []);
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
    await reloadSessions();
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
        <ul className="divide-y rounded-lg border">
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
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sessions</h2>
        <ul className="divide-y rounded-lg border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <IconDeviceLaptop className="text-muted-foreground size-5" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{clientOf(session.userAgent)}</span>
                <span className="text-muted-foreground text-xs">
                  since {new Date(session.createdAt).toLocaleString()}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke(session.token)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

import { createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, type Provider } from "../auth-client";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/account")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/" });
  },
  component: Account,
});

type Session = { id: string; token: string; createdAt: Date | string; userAgent?: string | null };

function Account() {
  const me = root.useLoaderData();
  const router = useRouter();
  const [sessions, setSessions] = useState<ReadonlyArray<Session>>([]);
  const [message, setMessage] = useState<string | null>(null);
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
    const { error } = await authClient.linkSocial({ provider, callbackURL: "/account" });
    if (error) setMessage(error.message ?? "Linking failed.");
  };
  // Better Auth unlinks by its own account row ID, never by the provider's subject.
  const unlink = async (accountId: string) => {
    const { error } = await authClient.unlinkAccount({ accountId });
    if (error) setMessage(error.message ?? "Unlinking failed.");
    else await router.invalidate();
  };
  const revoke = async (token: string) => {
    await authClient.revokeSession({ token });
    await reloadSessions();
  };
  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <section>
        <h1 className="text-lg font-medium">Account</h1>
        <p className="text-muted-foreground text-sm">
          {me.user.name}
          {me.user.email ? ` · ${me.user.email}` : ""}
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Identities</h2>
        {(["slack", "github"] as const).map((provider) => {
          const account = linked(provider);
          return (
            <div
              key={provider}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <div>
                <div className="font-medium capitalize">{provider}</div>
                <div className="text-muted-foreground">
                  {account
                    ? `Linked as ${account.accountId}${provider === "slack" && me.user.slackTeamId ? ` in team ${me.user.slackTeamId}` : ""}`
                    : "Not linked"}
                </div>
              </div>
              {account ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={me.accounts.length < 2}
                  onClick={() => unlink(account.id)}
                >
                  Unlink
                </Button>
              ) : (
                <Button size="sm" onClick={() => link(provider)}>
                  Link {provider === "slack" ? "Slack" : "GitHub"}
                </Button>
              )}
            </div>
          );
        })}
        {message ? <p className="text-destructive text-sm">{message}</p> : null}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sessions</h2>
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center justify-between rounded-md border p-3 text-sm"
          >
            <div>
              <div>{session.userAgent ?? "Unknown client"}</div>
              <div className="text-muted-foreground">
                Started {new Date(session.createdAt).toLocaleString()}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => revoke(session.token)}>
              Revoke
            </Button>
          </div>
        ))}
      </section>
      <section>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </section>
    </main>
  );
}

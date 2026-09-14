import { IconBrandGithub, IconBrandSlack } from "@tabler/icons-react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "../auth-client";

export const Route = createFileRoute("/sign-in")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData) throw redirect({ to: "/" });
  },
  component: SignIn,
});

function SignIn() {
  // A second start would replace the OAuth state cookie and orphan the first redirect.
  const [pending, setPending] = useState<"slack" | "github" | null>(null);
  const start = async (provider: "slack" | "github") => {
    if (pending) return;
    setPending(provider);
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/" });
    if (error) setPending(null);
  };
  const slack = () => start("slack");
  const github = () => start("github");
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Notus</h1>
          <p className="text-muted-foreground text-sm">
            Use the Slack account you mention Notus from, or your GitHub account. You can link the
            other one later.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button disabled={pending !== null} onClick={slack}>
            <IconBrandSlack className="size-4" />
            {pending === "slack" ? "Redirecting…" : "Continue with Slack"}
          </Button>
          <Button variant="outline" disabled={pending !== null} onClick={github}>
            <IconBrandGithub className="size-4" />
            {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
          </Button>
        </div>
      </div>
    </main>
  );
}

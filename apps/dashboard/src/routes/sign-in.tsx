import { IconBrandGithub, IconBrandSlack } from "@tabler/icons-react";
import { createFileRoute, redirect } from "@tanstack/react-router";
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
  const slack = () => authClient.signIn.social({ provider: "slack", callbackURL: "/" });
  const github = () => authClient.signIn.social({ provider: "github", callbackURL: "/" });
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
          <Button onClick={slack}>
            <IconBrandSlack className="size-4" />
            Continue with Slack
          </Button>
          <Button variant="outline" onClick={github}>
            <IconBrandGithub className="size-4" />
            Continue with GitHub
          </Button>
        </div>
      </div>
    </main>
  );
}

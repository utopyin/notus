import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { authClient } from "../auth-client";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const me = root.useLoaderData();
  if (me) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-lg font-medium">Signed in as {me.user.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {me.workspaces.length === 0
            ? "You are not a member of any workspace yet."
            : `Member of ${me.workspaces.length} workspace${me.workspaces.length === 1 ? "" : "s"}.`}
        </p>
      </main>
    );
  }
  return <SignIn />;
}

function SignIn() {
  const slack = () => authClient.signIn.social({ provider: "slack", callbackURL: "/" });
  const github = () => authClient.signIn.social({ provider: "github", callbackURL: "/" });
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-lg font-medium">Sign in to Notus</h1>
      <p className="text-muted-foreground text-sm">
        Use the Slack account you mention Notus from, or your GitHub account. You can link the other
        one afterwards.
      </p>
      <div className="flex gap-3">
        <Button onClick={slack}>Sign in with Slack</Button>
        <Button variant="outline" onClick={github}>
          Sign in with GitHub
        </Button>
      </div>
    </main>
  );
}

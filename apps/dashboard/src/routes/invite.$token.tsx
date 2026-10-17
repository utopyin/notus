import { createFileRoute, getRouteApi, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInvite } from "../server/workspaces";

const root = getRouteApi("__root__");

/**
 * Accepting needs a signed-in user; anonymous visitors sign in first and come back here. Joining
 * is a click, never the page load: a link another site opens must not add anyone to a workspace.
 */
export const Route = createFileRoute("/invite/$token")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/sign-in" });
  },
  component: Invite,
});

function Invite() {
  const me = root.useLoaderData();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [reason, setReason] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!me) return null;
  const accept = async () => {
    setPending(true);
    const result = await acceptInvite({ data: { token } });
    if (result.ok) {
      await navigate({ to: "/$slug", params: { slug: result.value.slug } });
      return;
    }
    setReason(result.reason);
    setPending(false);
  };
  const text =
    reason === null
      ? "You were invited to a Notus workspace."
      : reason === "expired"
        ? "This invite has expired, was revoked, or was already used."
        : reason === "not-found"
          ? "This invite link is not valid."
          : `The invite could not be accepted (${reason}).`;
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start gap-3 p-8">
      <h1 className="text-lg font-medium">Invite</h1>
      <p className="text-muted-foreground text-sm">{text}</p>
      {reason === null ? (
        <Button onClick={accept} disabled={pending}>
          Join workspace
        </Button>
      ) : null}
    </main>
  );
}

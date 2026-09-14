import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { acceptInvite } from "../server/workspaces";

const root = getRouteApi("__root__");

/** Accepting needs a signed-in user; anonymous visitors sign in first and come back here. */
export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/" });
    const result = await acceptInvite({ data: { token: params.token } });
    if (result.ok)
      throw redirect({ to: "/workspaces/$workspaceId", params: { workspaceId: result.value.id } });
    return { reason: result.reason };
  },
  component: Invite,
});

function Invite() {
  const me = root.useLoaderData();
  const { reason } = Route.useLoaderData();
  if (!me) return null;
  const text =
    reason === "expired"
      ? "This invite has expired, was revoked, or was already used."
      : reason === "not-found"
        ? "This invite link is not valid."
        : `The invite could not be accepted (${reason}).`;
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-medium">Invite</h1>
      <p className="text-muted-foreground text-sm">{text}</p>
    </main>
  );
}

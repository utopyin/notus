import { PROVIDER_DESCRIPTORS } from "@notus/compute/descriptors/index";
import { Provider } from "@notus/compute/provider";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KITS } from "../devbox/kit";
import { ProviderPage } from "../devbox/page";
import { getEnvironment } from "../server/devbox";

export const Route = createFileRoute("/$slug/devbox")({
  staticData: {
    shell: {
      active: "devbox",
      title: "Devbox",
      description: "The machine every task runs on.",
    },
  },
  validateSearch: (search: Record<string, unknown>): { provider?: string } => ({
    provider: typeof search.provider === "string" ? search.provider : undefined,
  }),
  loaderDeps: ({ search }) => ({ provider: search.provider ?? null }),
  loader: async ({ parentMatchPromise, deps }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return null;
    const result = await getEnvironment({
      data: { workspaceId: parent.loaderData.workspace.id, provider: deps.provider },
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  },
  component: Devbox,
});

/**
 * The provider the workspace runs on, or the one picked here when the deployment runs several.
 * Each provider brings its own kit; the cards are the same for all of them.
 */
function Devbox() {
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  if (data === null || !Schema.is(Provider)(data.provider)) return null;
  const provider = data.provider;
  const offered = data.providers.map((value) => ({
    value,
    label: PROVIDER_DESCRIPTORS[value].name,
  }));
  return (
    <>
      {offered.length > 1 ? (
        <Select
          value={provider}
          items={offered}
          onValueChange={(value) => {
            if (typeof value === "string") void navigate({ search: { provider: value } });
          }}
        >
          <SelectTrigger className="w-56" aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {offered.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {/* Keyed by provider, so switching drops the other provider's draft. */}
      {KITS[provider]((kit) => (
        <ProviderPage key={provider} kit={kit} data={data} />
      ))}
    </>
  );
}

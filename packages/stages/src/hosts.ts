/**
 * Public hostnames on notus.run, one pair per stage. Production owns the apex; every developer
 * stage lives under its own name so stages never share a cookie or callback URL.
 */
export const zone = "notus.run";
export const hostnames = (stage: string) =>
  stage === "production"
    ? { dashboard: zone, api: `api.${zone}` }
    : { dashboard: `${stage}.${zone}`, api: `api.${stage}.${zone}` };

/**
 * The stage being deployed, from the ALCHEMY_STAGE variable the deploy scripts set. Worker
 * declarations are evaluated again inside the deployed Worker, where no stage exists and the
 * hostnames do not matter, so this is null there.
 */
export const deployingStage = (): string | null => {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const value = host.process?.env?.ALCHEMY_STAGE;
  return value === undefined || value === "" ? null : value;
};
/** Custom-domain props for one of the two Workers, or nothing outside a deploy. */
export const domainOf = (which: "dashboard" | "api") => {
  const stage = deployingStage();
  return stage === null ? {} : { domain: { name: hostnames(stage)[which], zoneName: zone } };
};

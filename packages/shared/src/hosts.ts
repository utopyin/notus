/**
 * Public hostnames on notus.run, one pair per stage. Production owns the apex; every developer
 * stage lives under its own name so stages never share a cookie or callback URL. Resource props
 * read the stage through Alchemy's `Stack.useSync`, which is available at deploy and at runtime.
 */
export const zone = "notus.run";
export const hostnames = (stage: string) =>
  stage === "production"
    ? { dashboard: zone, api: `api.${zone}` }
    : { dashboard: `${stage}.${zone}`, api: `api.${stage}.${zone}` };

/** The API origin of a dashboard origin: `api.` in front of the same host, on every stage. */
export const apiOriginOf = (dashboardOrigin: string) => {
  const url = new URL(dashboardOrigin);
  url.host = `api.${url.host}`;
  return url.origin;
};

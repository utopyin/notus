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

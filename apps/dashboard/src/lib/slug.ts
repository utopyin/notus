/** Mirrors the server's default: the kebab-case form of a name. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
export const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]{1,47}$/.test(slug);

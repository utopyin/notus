/** Alchemy's bundler inlines a `?raw` import as the file's text. */
declare module "*?raw" {
  const content: string;
  export default content;
}

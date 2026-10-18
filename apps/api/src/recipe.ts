import type { Provider } from "@notus/compute/provider";
import { Recipe, type RecipeFile } from "@notus/compute/recipe";
import * as Layer from "effect/Layer";
// The devbox app's files, inlined at deploy. `dist/main.js` exists only after
// `bun run --cwd apps/devbox build`, which the deploy scripts run first.
import supervisor from "../../devbox/dist/main.js?raw";
import launcher from "../../devbox/notus-devbox?raw";
import boatRecipe from "../../devbox/boat/recipe.sh?raw";
import boatUnit from "../../devbox/boat/notus-devbox.service?raw";

/**
 * The Notus base recipe this deployment builds templates from, with the supervisor bundle it
 * deploys beside its control plane. Only providers that build their own template have files.
 */
const files: { readonly [P in Provider]: ReadonlyArray<RecipeFile> } = {
  namespace: [],
  boat: [
    { name: "recipe.sh", content: boatRecipe },
    { name: "notus-devbox.service", content: boatUnit },
    { name: "notus-devbox", content: launcher },
    { name: "main.js", content: supervisor },
  ],
};

export const layer = Layer.succeed(Recipe, Recipe.of({ files: (provider) => files[provider] }));

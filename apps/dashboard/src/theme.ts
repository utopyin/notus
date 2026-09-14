import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

/** Where the choice lives; "system" is the absence of a choice. */
const key = "notus-theme";

/**
 * Runs before the first paint so a dark page never flashes light. Kept as a string because it is
 * inlined into the document head, ahead of any bundle.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(key)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

const listeners = new Set<() => void>();
const prefersDark = () => matchMedia("(prefers-color-scheme: dark)");

const read = (): Theme => {
  const stored = localStorage.getItem(key);
  return stored === "light" || stored === "dark" ? stored : "system";
};

const apply = (theme: Theme) => {
  const dark = theme === "dark" || (theme === "system" && prefersDark().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

export const setTheme = (theme: Theme) => {
  if (theme === "system") localStorage.removeItem(key);
  else localStorage.setItem(key, theme);
  apply(theme);
  for (const listener of listeners) listener();
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  // A system-following page has to react to the OS switching, not only to the menu.
  const media = prefersDark();
  const onMedia = () => {
    apply(read());
    onChange();
  };
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onMedia);
  };
};

/** The chosen theme; "system" on the server and until hydration. */
export const useTheme = () => useSyncExternalStore(subscribe, read, () => "system" as Theme);

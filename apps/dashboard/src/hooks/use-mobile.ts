import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

const query = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

const subscribe = (onChange: () => void) => {
  const mql = query();
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/** Whether the viewport is narrower than the sidebar's breakpoint; false when rendering on the server. */
export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false,
  );
}

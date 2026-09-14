import { QueryClient } from "@tanstack/react-query";

/** One client per browser session; TanStack DB collections sync through it. */
export const queryClient = new QueryClient();

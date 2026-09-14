import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";
import { getMe } from "../server/me";

/** The document shell. Every page asks the root loader who is signed in. */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Notus" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: () => getMe(),
  component: () => (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-medium">Not found</h1>
      <p className="text-muted-foreground text-sm">The requested page does not exist.</p>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

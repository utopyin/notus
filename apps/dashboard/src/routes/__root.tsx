import type { ReactNode } from "react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { getMe } from "../server/me";

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
  component: RootComponent,
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-medium">Not found</h1>
      <p className="text-muted-foreground text-sm">The requested page does not exist.</p>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootComponent() {
  const me = Route.useLoaderData();
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3 text-sm">
          <Link to="/" className="font-medium">
            Notus
          </Link>
          {me ? (
            <>
              <Link to="/workspaces" className="text-muted-foreground hover:text-foreground">
                Workspaces
              </Link>
              <Link to="/account" className="text-muted-foreground hover:text-foreground">
                Account
              </Link>
              <span className="text-muted-foreground ml-auto">{me.user.name}</span>
            </>
          ) : null}
        </nav>
      </header>
      <Outlet />
    </>
  );
}

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

import { IconGitBranch, IconLockFilled } from "@tabler/icons-react";
import type { FC } from "react";
import { Scopes, type Installation } from "../scopes";
import type { WorkspaceView } from "../../server/workspaces";

/** A repository: the owner muted, the name in full, a lock when private. */
const Repository: FC<{ fullName: string; isPrivate: boolean }> = ({ fullName, isPrivate }) => {
  const [owner, name] = fullName.split("/");
  return (
    <>
      {isPrivate ? (
        <IconLockFilled className="text-muted-foreground size-4 shrink-0" />
      ) : (
        <IconGitBranch className="text-muted-foreground size-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate leading-4">
        <span className="text-muted-foreground">{owner}/</span>
        <span className="font-medium">{name ?? fullName}</span>
      </span>
    </>
  );
};

export const GithubDetails: FC<{
  view: WorkspaceView;
  installation: Installation;
  isAdmin: boolean;
}> = ({ view, installation, isAdmin }) => (
  <Scopes
    view={view}
    installation={installation}
    isAdmin={isAdmin}
    row={(scope, info) => <Repository fullName={scope.scope} isPrivate={info?.private ?? false} />}
    option={(scope) => <Repository fullName={scope.label} isPrivate={scope.private} />}
    missingHint="Grant the App access to a repository in GitHub first if it is missing here."
    identifierPlaceholder="owner/name"
  />
);

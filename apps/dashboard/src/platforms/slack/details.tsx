import { IconHash, IconLockFilled } from "@tabler/icons-react";
import type { FC } from "react";
import { Scopes, type Installation } from "../scopes";
import type { WorkspaceView } from "../../server/workspaces";

/** A Slack channel: hash or lock, the name, and the ID underneath. */
const Channel: FC<{ id: string; name: string; isPrivate: boolean }> = ({ id, name, isPrivate }) => (
  <>
    {isPrivate ? (
      <IconLockFilled className="text-muted-foreground size-4 shrink-0" />
    ) : (
      <IconHash className="text-muted-foreground size-4 shrink-0" />
    )}
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="truncate leading-4 font-medium">{name}</span>
      <span className="text-muted-foreground font-mono text-xs">{id}</span>
    </div>
  </>
);

export const SlackDetails: FC<{
  view: WorkspaceView;
  installation: Installation;
  isAdmin: boolean;
}> = ({ view, installation, isAdmin }) => (
  <Scopes
    view={view}
    installation={installation}
    isAdmin={isAdmin}
    row={(scope, info) => (
      <Channel
        id={scope.scope}
        name={info?.label ?? scope.label ?? scope.scope}
        isPrivate={info?.private ?? false}
      />
    )}
    option={(scope) => (
      <>
        {scope.private ? (
          <IconLockFilled className="text-muted-foreground" />
        ) : (
          <IconHash className="text-muted-foreground" />
        )}
        {scope.label}
      </>
    )}
    missingHint="Invite the app to a channel in Slack first if it is missing here."
    identifierPlaceholder="C0123456789"
  />
);

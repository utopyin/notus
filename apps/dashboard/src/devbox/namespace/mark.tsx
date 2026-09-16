import { IconServer2 } from "@tabler/icons-react";
import type { FC } from "react";

/** The provider's mark on the devbox card. */
export const NamespaceMark: FC<{ className?: string }> = ({ className }) => (
  <IconServer2 className={className} />
);

import { IconSailboat } from "@tabler/icons-react";
import type { FC } from "react";

/** The provider's mark on the devbox card. */
export const BoatMark: FC<{ className?: string }> = ({ className }) => (
  <IconSailboat className={className} />
);

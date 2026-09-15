import type { PlatformDescriptor } from "../descriptor";
import type { Platform } from "../platform";
import { GITHUB_DESCRIPTOR } from "./github";
import { SLACK_DESCRIPTOR } from "./slack";

/** Total over `Platform`: a platform without a descriptor is a compile error here. */
export const PLATFORM_DESCRIPTORS: { readonly [P in Platform]: PlatformDescriptor<P> } = {
  slack: SLACK_DESCRIPTOR,
  github: GITHUB_DESCRIPTOR,
};
export { GITHUB_DESCRIPTOR, SLACK_DESCRIPTOR };

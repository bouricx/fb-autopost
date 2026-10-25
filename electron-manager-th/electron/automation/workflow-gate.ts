import { postIdentity } from "./post-target";
export function canCreatePostFollowUps(result: { status?: string; permalink?: string }): boolean {
  return result.status === "published" && !!result.permalink && postIdentity(result.permalink) !== null;
}

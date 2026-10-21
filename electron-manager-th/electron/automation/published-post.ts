import { postIdentity } from "./post-target";
export interface PublishedPostEvidence { url: string; text: string; authors: { name: string; url: string }[]; mediaCount: number }
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
export function verifyPublishedPost(evidence: PublishedPostEvidence, expected: { destination: string; caption: string; accountName: string; userId?: string; mediaCount: number }, before: Set<string>): boolean {
  const identity = postIdentity(evidence.url);
  if (!identity || before.has(identity)) return false;
  const destination = new URL(expected.destination), url = new URL(evidence.url);
  const group = destination.pathname.match(/^\/groups\/([^/]+)/)?.[1];
  if (group && url.pathname.match(/^\/groups\/([^/]+)/)?.[1] !== group) return false;
  if (expected.caption.trim() && !normalize(evidence.text).includes(normalize(expected.caption))) return false;
  if (expected.mediaCount && evidence.mediaCount < expected.mediaCount) return false;
  return evidence.authors.some(author => {
    if (expected.userId) {
      try {
        const profile = new URL(author.url);
        if (profile.searchParams.get("id") === expected.userId || profile.pathname.split("/").includes(expected.userId)) return true;
      } catch { /* Ignore invalid profile links. */ }
    }
    return !!normalize(expected.accountName) && normalize(author.name) === normalize(expected.accountName);
  });
}
export function canonicalPostUrl(value: string): string {
  const url = new URL(value);
  const story = url.searchParams.get("story_fbid"), owner = url.searchParams.get("id");
  url.search = ""; url.hash = "";
  if (story) { url.searchParams.set("story_fbid", story); if (owner) url.searchParams.set("id", owner); }
  return url.toString();
}

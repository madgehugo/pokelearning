/** Update check: asks GitHub for the latest release and says whether it is newer than this build. */
import { compareVersions, type UpdateInfo } from "@pokelearning/shared";

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** The newer release, or null when this build is current, there are no releases, or GitHub can't be reached. */
export async function checkForUpdate(current: string, repo: string, fetchFn: Fetch = fetch): Promise<UpdateInfo | null> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "pokelearning" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null; // 404 = no release yet
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const version = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/, "") : "";
    if (typeof body.html_url !== "string" || !(compareVersions(version, current) > 0)) return null;
    return { version, url: body.html_url };
  } catch {
    return null;
  }
}

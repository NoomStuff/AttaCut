import { z } from "zod";
import type { AvailableUpdate } from "../shared/types.ts";

const releaseSchema = z.object({
   tag_name: z.string(),
   name: z.string().nullable(),
   html_url: z.string().url(),
   draft: z.boolean(),
   prerelease: z.boolean(),
});

export const updateInterval = 8 * 60 * 60 * 1000;

function parts(version: string): number[] | null {
   const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
   return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
   const next = parts(candidate);
   const installed = parts(current);
   if (!next || !installed) return false;
   for (let index = 0; index < next.length; index++) {
      if (next[index] !== installed[index]) return next[index]! > installed[index]!;
   }
   return false;
}

export async function fetchAvailableUpdate(
   currentVersion: string,
   request: (url: string, init: RequestInit) => Promise<Response>
): Promise<AvailableUpdate | null> {
   const response = await request("https://api.github.com/repos/NoomStuff/AttaCut/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `AttaCut/${currentVersion}` },
   });
   if (!response.ok) throw new Error(`Update check failed with ${response.status}.`);
   const release = releaseSchema.parse(await response.json());
   const version = release.tag_name.replace(/^v/, "");
   if (release.draft || release.prerelease || !isNewerVersion(version, currentVersion)) return null;
   return { version, name: release.name?.trim() || `AttaCut ${version}`, url: release.html_url };
}

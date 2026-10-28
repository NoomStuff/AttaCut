import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";

const script = execFileSync(
   "bun",
   ["-e", 'import { YAML } from "bun"; console.log(YAML.parse(await Bun.file(".github/workflows/release.yml").text()).jobs.prepare.steps[0].with.script)'],
   { encoding: "utf8", windowsHide: true }
);
const select = new Function("github", "context", "core", "process", `return (async () => {${script}})();`) as (
   github: object,
   context: object,
   core: object,
   process: object
) => Promise<void>;

it.each([
   "new release",
   "public version",
   "private public version",
   "private exact commit",
   "invalid commit",
   "wrong resolved commit",
   "superseded",
   "reserved tag",
   "wrong branch",
   "invalid version",
   "lookup failed",
])("release selection: %s", async (scenario) => {
   const sha = "a".repeat(40);
   const missing = () => {
      throw Object.assign(new Error("Missing"), { status: 404 });
   };
   const tagLookup = vi.fn(scenario === "reserved tag" ? () => ({ data: { object: { sha } } }) : missing);
   const outputs: Record<string, string> = {};
   const github = {
      rest: {
         repos: {
            getCommit: vi.fn(async () => ({ data: { sha: scenario === "wrong resolved commit" ? "b".repeat(40) : sha } })),
            getContent: vi.fn(async () => ({
               data: { content: Buffer.from(JSON.stringify({ version: scenario === "invalid version" ? "invalid" : "1.2.3" })).toString("base64") },
            })),
            getReleaseByTag: vi.fn(async () => {
               if (scenario === "lookup failed") throw Object.assign(new Error("Forbidden"), { status: 403 });
               if (scenario === "public version") return { data: { draft: false } };
               return missing();
            }),
         },
         git: {
            getRef: vi.fn(async (input: { ref: string }) =>
               input.ref === "heads/main" ? { data: { object: { sha: scenario === "superseded" ? "b".repeat(40) : sha } } } : tagLookup()
            ),
         },
      },
   };
   const privateCandidate = scenario.startsWith("private") || ["invalid commit", "wrong resolved commit"].includes(scenario);
   const core = {
      setOutput: (key: string, value: string) => {
         outputs[key] = value;
      },
      summary: { addRaw: vi.fn().mockReturnValue({ write: vi.fn() }) },
   };
   const context = {
      repo: { owner: "test", repo: "app" },
      sha,
      ref: scenario === "wrong branch" ? "refs/heads/branch" : "refs/heads/main",
      eventName: privateCandidate ? "workflow_dispatch" : "push",
   };
   const env = {
      CANDIDATE_SHA: scenario === "private exact commit" || scenario === "wrong resolved commit" ? sha : scenario === "invalid commit" ? "main" : "",
      VERIFY_CANDIDATE: privateCandidate ? "true" : "false",
   };
   if (["new release", "public version", "private public version", "private exact commit", "superseded"].includes(scenario)) {
      await select(github, context, core, { env });
      expect(outputs["candidate_sha"]).toBe(sha);
      expect(outputs["build"]).toBe(["public version", "superseded"].includes(scenario) ? "false" : "true");
      expect(outputs["publish"]).toBe(scenario === "new release" ? "true" : "false");
      if (privateCandidate) {
         expect(github.rest.repos.getReleaseByTag).not.toHaveBeenCalled();
         expect(github.rest.git.getRef).not.toHaveBeenCalled();
      }
   } else await expect(select(github, context, core, { env })).rejects.toThrow();
});

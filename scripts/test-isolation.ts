// CI=true alone is also used by local release verification. It is not isolation.
export function hasDisposableDesktop(env: NodeJS.ProcessEnv = process.env): boolean {
   return env["GITHUB_ACTIONS"] === "true" && env["RUNNER_ENVIRONMENT"] === "github-hosted";
}

export function requireDisposableDesktop(): void {
   if (!hasDisposableDesktop()) {
      throw new Error(
         "Desktop tests require a disposable GitHub-hosted runner. Use bun run test:ui, test:playback, test:native or verify:release. No desktop tests ran locally."
      );
   }
}

export default requireDisposableDesktop;

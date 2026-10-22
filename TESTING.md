# Running tests

`bun run verify` and `bun run test:media` run locally. Media tests decode and compare real files with FFmpeg. They do not open a player or audio device.

Desktop tests need a disposable machine. Transparent windows can still steal focus, native shortcuts target the active desktop, and an installer upgrade opens real windows. Muting Electron also hides part of the audio path. None of those techniques isolate a test from someone using the computer.

These commands dispatch the exact pushed commit to the `Isolated desktop tests` GitHub Actions workflow and wait for its result:

- `bun run test:ui`
- `bun run test:playback`
- `bun run test:native`
- `bun run test:all`
- `bun run verify:package`
- `bun run verify:release`

They require an authenticated `gh` CLI, a clean checkout, and a commit available on origin. They never commit, push, upload local files, or open a local test app. Local edits stay local. A dirty checkout fails before dispatch. Changes during a remote run invalidate the command's result for the local checkout.

The runner matches the local OS and architecture. Each job uses a fresh GitHub-hosted machine. Linux also uses a private Xvfb display and a null audio sink. Native tests retain their real focus, keyboard and dialog checks inside the disposable machine. Audio stays unmuted in Electron. Tests retain their frame, decoded PCM, timing, export, installer and failure assertions.

Packaged verification builds a fresh package from the recorded source commit. It does not validate an existing local `release/` directory or other ignored local build outputs. The workflow records the source SHA and runner identity, preserves diagnostics, and has no publication step. It does not change a release or tag.

Direct Playwright and installer entry points reject ordinary desktops, including when `CI=true`. The hosted-runner environment is the execution contract. Do not forge those variables to bypass the guard on a personal desktop. Offline or uncommitted desktop testing needs a separately provisioned disposable machine. Until that exists, those checks remain explicitly unrun.

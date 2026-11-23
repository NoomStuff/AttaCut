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

The runner matches the local OS and architecture. Each job uses a fresh GitHub-hosted machine. Linux also uses a private Xvfb display with Openbox and a null audio sink. Native tests retain their real focus, keyboard and dialog checks inside the disposable machine. Audio stays unmuted in Electron. Tests retain their frame, decoded PCM, timing, export, installer and failure assertions.

Packaged verification builds a fresh package from the recorded source commit. It does not validate an existing local `release/` directory or other ignored local build outputs. The workflow records the source SHA and runner identity, preserves diagnostics, and has no publication step. It does not change a release or tag.

Direct Playwright and installer entry points reject ordinary desktops, including when `CI=true`. Do not forge the hosted-runner or private-desktop variables to bypass the guard on a personal desktop.

## Local app tests on Linux

`bun run test:local` runs the Playwright app tests against the working tree, uncommitted changes included. It starts a private Xvfb display with Openbox, a PipeWire or PulseAudio server whose only device is a null sink, and a D-Bus session that starts no services. That is the same setup as the hosted Linux job. App windows, synthetic input and sound stay inside it, so a test never takes focus or plays through your speakers.

```sh
bun run test:local                           # every ui spec
bun run test:local timeline                  # spec files matching "timeline"
bun run test:local -g "splits a clip"        # test titles matching
bun run test:local playback                  # format playback matrix
bun run test:local native                    # focus and fullscreen checks
bun run test:local --no-build export-dialog  # reuse the bundle in out/
```

It needs `xvfb-run`, `openbox`, `xprop`, `dbus-run-session` and `pactl`, plus either PipeWire with `pipewire-pulse` and WirePlumber or PulseAudio. It retries a failed test once, like the hosted runner, and lists a pass on retry as flaky. A full run on a slow machine can show a timing flake that passes alone. It rebuilds fixtures only when `tests/create-fixtures.ts` changes and skips the typecheck, so `bun run verify` still has to pass. Traces, logs and failure screenshots land in `test-results/`. Open a trace with `bunx playwright show-trace <path>/trace.zip`.

A local pass is fast feedback. The remote commands above remain the record for releases and for Windows and macOS. Packaging, installer and update checks never run locally, because they write outside the test profile.

## Driving a dev app

`bun run app` keeps one dev instance of AttaCut running for agents and scripts to inspect between edits. On Linux it uses the same private display and audio server as `test:local`. Elsewhere the window stays invisible, click-through and muted. Either way it uses a throwaway profile in `work/agent-app/profile`, so your settings, recent files and recovery session stay untouched.

```sh
bun run app start work/fixture.mp4   # build, launch, print status
bun run app tree 'role=banner'       # accessibility tree
bun run app click 'role=button[name="Export"]'
bun run app press Control+z
bun run app shot                     # prints the PNG path
bun run app eval 'document.querySelector("video").currentTime'
bun run app logs                     # new main, renderer and Vite lines
bun run app stop
```

Renderer edits hot-reload through Vite without losing the loaded video. Run `bun run app restart` after changing `src/main` or `src/preload`. `bun run app help` lists every command. The session stops itself after 30 minutes without a command.

## Media tests

`bun run test:media` runs every FFmpeg suite. Name suites to run only those, such as `bun run test:media exports joins`. The runner adds the suites they read from, `formats` and `metadata`, and reuses their earlier output under `work/` unless you pass `--fresh`. `test:media` and `test:local` use `FFMPEG_PATH` and `FFPROBE_PATH` when set. Otherwise they download the pinned FFmpeg from `scripts/media-lock.ts` once into `work/media-toolchain-<hash>` and reuse it, so a distro FFmpeg with different decoders cannot fail a format check.

## Running locally

You need [Bun](https://bun.sh/) and FFmpeg with ffprobe on your PATH.

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/NoomStuff/AttaCut.git
   cd AttaCut
   bun install
   ```

2. Download deps and start the app:

   ```sh
   bun install
   bun run dev
   ```

Dev mode calls your local FFmpeg, and `FFMPEG_PATH` / `FFPROBE_PATH` can point somewhere unusual if needed.

## Building installers

Run `bun run dist` on the operating system and CPU architecture you want to build for. It makes the portable build for that host. Builds support x64 and arm64 hosts. Output goes into `release/`, with the OS and architecture in each filename. `bun run package` creates an unpacked app for the current host.

| Host    | Command                      | Output                                |
| ------- | ---------------------------- | ------------------------------------- |
| Windows | `bun run dist:win`           | Portable `.exe`                       |
| Windows | `bun run dist:win:installer` | Installer `.exe`                      |
| Windows | `bun run dist:win:all`       | Both `.exe` builds for release checks |
| macOS   | `bun run dist:mac`           | `.zip` app bundle                     |
| macOS   | `bun run dist:mac:dmg`       | `.dmg`                                |
| macOS   | `bun run dist:mac:all`       | Both formats for release checks       |
| Linux   | `bun run dist:linux`         | `.AppImage`                           |

Packaged apps include FFmpeg and ffprobe, so users do not need to install them. Supply binaries for the build host:

- Windows can use FFmpeg on PATH. Packaging also copies adjacent DLLs.
- macOS requires standalone binaries that depend only on `/usr/lib` or `/System/Library`. A regular Homebrew FFmpeg installation depends on other Homebrew libraries and cannot be bundled by this build script.
- Linux requires FFmpeg and ffprobe with statically linked codecs. System C runtime and GCC support libraries are allowed. A regular distro FFmpeg installation uses shared codec libraries and cannot be bundled by this build script.

For macOS and Linux, point to your standalone binaries before building:

```sh
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
bun run dist
```

macOS distribution signing and notarization use electron-builder's certificate and Apple credentials configuration. The build includes both media executables in signing. Without credentials, builds are for local testing and are not notarized. See [electron-builder's macOS signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) before distributing to other users. Build commands never publish artifacts automatically.

The release workflow publishes only app packages on GitHub Releases. It writes Windows and Linux update feeds to the `updates` branch, with links back to those packages. The Windows Installer and Linux AppImage builds use those feeds for in-app updates. Windows Installer downloads the whole installer because its separate blockmap is not published. The portable build downloads the plain Windows EXE to Downloads and verifies GitHub's SHA-256 asset digest. Keep the Installer and plain EXE artifact names distinct, and keep the Installer target pointing at the splash launcher when changing the Windows package layout. Builds through 0.13.2 still look for update feeds on the release itself, so moving to 0.13.3 requires one manual update.

---

## Commands

| Command                  | Description                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bun run dev`            | Start the app in dev mode                                                                                  |
| `bun run test`           | Run the unit tests                                                                                         |
| `bun run package`        | Build and bundle the unpacked app                                                                          |
| `bun run dist`           | Build the portable app for the current OS                                                                  |
| `bun run format`         | Format the code                                                                                            |
| `bun run verify`         | Run formatting, lint, unit tests, and build                                                                |
| `bun run verify:release` | Run the same checks, media tests, UI tests, packaging, and packaged app tests used by Actions on this host |

## Tests

- `bun run test` runs the unit tests.
- `bun run test:media` generates fixtures and checks cut accuracy, format support, metadata, keyframes, cancellation, and exports against real FFmpeg.
- `bun run test:ui` generates the basic fixtures, builds the app, and runs the Playwright UI tests.
- `bun run test:playback` runs the media suite, builds the app, and checks that each format and its exported clip actually play in Electron.
- `bun run test:all` runs all of the above without repeating the media suite or build.
- `bun run test:native` runs the opt-in visible native interaction smoke.

Integration tests live in `tests/media` and `tests/ui`. They need FFmpeg and ffprobe on PATH, or `FFMPEG_PATH` and `FFPROBE_PATH`. UI tests also need a desktop session. They run one at a time to avoid competing for media resources. Electron tests run invisibly with muted device audio. On Windows and macOS, a zero-opacity window keeps video and animation rendering active without requesting focus. It has no taskbar entry and ignores native mouse input. On Linux, the window stays hidden and cannot take focus, including during native fullscreen transitions. Playwright mouse and keyboard input still reaches the app.

To watch or debug a UI run in PowerShell, set `$env:ATTACUT_TEST_VISIBLE = "1"`, run `bun run test:ui`, then remove it with `Remove-Item Env:ATTACUT_TEST_VISIBLE`. In a POSIX shell, use `ATTACUT_TEST_VISIBLE=1 bun run test:ui`. Visible runs also mute device audio. The Windows release check still briefly shows the native splash launcher and app window to verify that launching the packaged app works. It shows the app without requesting foreground focus and only closes the process it started.

Before a release, run `bun run verify:release`. It installs from the frozen lockfile, downloads the pinned FFmpeg build, and tests the unpacked app after building the release packages. The command takes several minutes. A passing `bun run build` only checks compilation. Run the release check on each OS and CPU architecture you plan to ship, since one host cannot execute another host's Electron package.

Open a pull request before pushing a version change to `main`. Its checks build and verify packages on Windows, macOS, and Linux. The push to `main` runs those checks once more before publishing the release. A local `bun run verify:release` catches problems on your own OS, but it cannot check packages for the other platforms.

Actions gives a failed Playwright test one retry in a fresh Electron process. A recovered test appears as flaky in the job log, with its failed trace attached to the run. If a release fails for a transient runner problem, use **Re-run failed jobs** on that same Actions run. It uses the same commit and version, so a retry does not need another push or version bump. Candidate packages stay available as run artifacts after packaging, but GitHub publishes them only after the checks and every packaged verification pass. Investigate and fix a failure that repeats on retry.

### Focused native checks and seek benchmarks

`bun run test:native` briefly shows and focuses the app to check native activation, minimization and restoration. On Windows it sends an OS keyboard shortcut and opens/cancels the real file picker. This is opt-in; routine UI and release checks keep their background presentation. macOS/Linux need their own native smoke runs. Speaker audibility still needs manual playback.

The long-recording UI test checks bounded completion, without assuming every machine meets the same seek latency. To measure seven decoded seeks on controlled hardware in PowerShell:

```powershell
$env:ATTACUT_SEEK_BENCHMARK = "1"
# Optional representative recording and median latency target.
$env:ATTACUT_LONG_VIDEO = "D:/recordings/benchmark.mp4"
$env:ATTACUT_SEEK_TARGET_MS = "750"
bun x --no-install playwright test --project=ui tests/ui/long-video.spec.mjs --grep "controlled seek benchmark"
Remove-Item Env:ATTACUT_SEEK_BENCHMARK, Env:ATTACUT_LONG_VIDEO, Env:ATTACUT_SEEK_TARGET_MS
```

Use a recording at least 115 minutes long for these fixed seek targets. Without `ATTACUT_LONG_VIDEO`, the test generates a two-hour fixture. Record the machine, storage, codec and sample times when comparing benchmark runs. The target applies to the median, measured inside the renderer after decoding the seek, excluding Playwright command overhead.

---

## License

AttaCut is released under the [MIT license](LICENSE). By contributing, you agree that your changes are released under the same license.

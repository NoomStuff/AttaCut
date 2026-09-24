## Running locally

You need [Bun](https://bun.sh/) at the version in `.bun-version` and FFmpeg with ffprobe on your PATH.

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

Run `bun run dist` on the operating system and CPU architecture you want to build for. Builds support x64 and arm64 hosts. Output goes into `release/`, with the OS and architecture in each filename. `bun run package` creates an unpacked app for the current host.

| Host    | Command              | Output      |
| ------- | -------------------- | ----------- |
| Windows | `bun run dist:win`   | `.exe`      |
| macOS   | `bun run dist:mac`   | `.dmg`      |
| Linux   | `bun run dist:linux` | `.AppImage` |

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

---

## Commands

| Command                  | Description                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bun run dev`            | Start the app in dev mode                                                                                  |
| `bun run test`           | Run the unit tests                                                                                         |
| `bun run package`        | Build and bundle the unpacked app                                                                          |
| `bun run dist`           | Build an installer for the current OS                                                                      |
| `bun run format`         | Format the code                                                                                            |
| `bun run verify`         | Run formatting, lint, unit tests, and build                                                                |
| `bun run verify:release` | Run the same checks, media tests, UI tests, packaging, and packaged app tests used by Actions on this host |

## Tests

- `bun run test` runs the unit tests.
- `bun run test:media` generates fixtures and checks cut accuracy, format support, metadata, keyframes, cancellation, and exports against real FFmpeg.
- `bun run test:ui` generates the basic fixtures, builds the app, and runs the Playwright UI tests.
- `bun run test:playback` runs the media suite, builds the app, and checks that each format and its exported clip actually play in Electron.
- `bun run test:all` runs all of the above without repeating the media suite or build.

Integration tests live in `tests/media` and `tests/ui`. They need FFmpeg and ffprobe on PATH, or `FFMPEG_PATH` and `FFPROBE_PATH`. UI tests also need a desktop session. They run one at a time because Electron windows share keyboard focus.

Before a release, run `bun run verify:release`. It installs from the frozen lockfile, downloads the pinned FFmpeg build, and tests the unpacked app after building the installer. The command takes several minutes. A passing `bun run build` only checks compilation. Run the release check on each OS and CPU architecture you plan to ship, since one host cannot execute another host's Electron package.

Actions gives a failed Playwright test one retry in a fresh Electron process. A recovered test appears as flaky in the job log, with its failed trace attached to the run. If a release fails for a transient runner problem, use **Re-run failed jobs** on that same Actions run. It uses the same commit and version, so a retry does not need another push or version bump. Candidate packages stay available as run artifacts after packaging, but GitHub publishes them only after the checks and every packaged verification pass. Investigate and fix a failure that repeats on retry.

---

## License

AttaCut is released under the [MIT license](LICENSE). By contributing, you agree that your changes are released under the same license.

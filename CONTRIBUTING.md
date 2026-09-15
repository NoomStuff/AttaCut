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

| Command           | Description                                 |
| ----------------- | ------------------------------------------- |
| `bun run dev`     | Start the app in dev mode                   |
| `bun run test`    | Run the unit tests                          |
| `bun run package` | Build and bundle the unpacked app           |
| `bun run dist`    | Build an installer for the current OS       |
| `bun run format`  | Format the code                             |
| `bun run verify`  | Run formatting, lint, unit tests, and build |

The finer-grained suites (`test:ui`, `test:formats`, and friends) each exercise one slice of the app, and `test:fixtures` generates the media files they need. `format` and `verify` are going to be your best buds here before committing.

---

## License

AttaCut is released under the [MIT license](LICENSE). By contributing, you agree that your changes are released under the same license.

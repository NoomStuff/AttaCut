## Set up

Install [Bun](https://bun.sh/) and FFmpeg with `ffprobe` on your PATH. Clone the repository, install dependencies, and start the app:

```sh
git clone https://github.com/NoomStuff/AttaCut.git
cd AttaCut
bun install
bun run dev
```

Development and integration tests use the local FFmpeg binaries. Set `FFMPEG_PATH` and `FFPROBE_PATH` if they are not on your PATH.

## Common commands

| Command                  | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `bun run dev`            | Start the app                                 |
| `bun run test`           | Run unit tests                                |
| `bun run test:media`     | Run FFmpeg-backed export tests                |
| `bun run test:ui`        | Build the app and run UI tests                |
| `bun run test:playback`  | Run media tests and packaged playback checks  |
| `bun run test:all`       | Run unit, media, UI, and playback tests       |
| `bun run test:native`    | Run the opt-in native interaction smoke test  |
| `bun run format`         | Format the repository                         |
| `bun run verify`         | Check formatting, lint, unit tests, and build |
| `bun run verify:release` | Run the release checks for the current host   |

Media and UI tests need FFmpeg and `ffprobe`. UI tests need a desktop session. On Linux, use `xvfb-run --auto-servernum bun run test:ui` when a visible desktop is unavailable. Use `ATTACUT_TEST_VISIBLE=1` to show the app during UI tests.

Before release, run `bun run verify:release`. It downloads the pinned FFmpeg build, packages the app, and checks the packaged result. Run it on each target OS and CPU architecture. A build on one host cannot verify another platform's Electron package.

## Build packages

Run `bun run package` to create an unpacked app for the current host. Run `bun run dist` for the portable package. Platform-specific commands are available for Windows, macOS, and Linux:

| Host    | Commands                                                                 | Output                           |
| ------- | ------------------------------------------------------------------------ | -------------------------------- |
| Windows | `bun run dist:win`, `bun run dist:win:installer`, `bun run dist:win:all` | Portable EXE, installer, or both |
| macOS   | `bun run dist:mac`, `bun run dist:mac:dmg`, `bun run dist:mac:all`       | ZIP app, DMG, or both            |
| Linux   | `bun run dist:linux`                                                     | AppImage                         |

Packages include FFmpeg and `ffprobe`. Windows can use FFmpeg on PATH. macOS needs standalone binaries that depend only on `/usr/lib` or `/System/Library`; a standard Homebrew build cannot be bundled. Linux needs binaries with statically linked codecs; a standard distro build cannot be bundled. Set `FFMPEG_PATH` and `FFPROBE_PATH` to those binaries when packaging on macOS or Linux.

macOS signing and notarization require Apple credentials configured for electron-builder. Without them, the build is for local testing and is not notarized. See [electron-builder's macOS signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) before distributing.

Build commands do not publish artifacts. The release workflow publishes packages to GitHub Releases and update feeds to the `updates` branch. Open a pull request for a version change so CI can check all supported platforms before merging.

## License

AttaCut is released under the [MIT license](LICENSE). Contributions are released under the same license.

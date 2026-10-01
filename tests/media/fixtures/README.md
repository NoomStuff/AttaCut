# Dynamic HDR fixture

hdr10plus.mp4 is a synthetic four-second 64x64 testsrc2 recording at 24 fps, with 10-bit PQ/BT.2020 HEVC and HDR10+ metadata on every frame. It contains no external media. generate-hdr10plus.ts writes the authored x265 metadata and verifies the encoded side data before replacing the fixture.

The test uses this file because HDR10+ encoding is optional in x265 builds. Requiring every bundled encoder to generate it would reject an app that correctly recognizes and protects existing HDR10+ recordings.

Regenerate it with an FFmpeg build whose libx265 supports dhdr10-info, from the repository root:

```sh
bun tests/media/fixtures/generate-hdr10plus.ts
```

After regeneration, run bun tests/media/dynamic-hdr.ts. It must recognize real decoded HDR10+ side data and refuse a cut that needs boundary encoding.

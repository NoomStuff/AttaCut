# AttaCut

We are building a fast, cross-platform video trimmer for getting clips out of a recording with as little effort as possible.

## What we optimize for

1. **Correctness.** The exported video must match the chosen clips and original video. Preserve the source and as much of its media as possible, including all its content and metadata.
2. **Speed.** Opening a recording, finding a moment, trimming, and exporting should be a short visit. Absolutely minimise load times and preload details when needed without blocking the user. Prefer a happy path where silent loads can happen in the background as the user gets instant feedback.
3. **Polish.** The preview gets the space. Controls are compact, clear, and pleasant to use. Motion should fluent while explaining a change or providing feedback without making editing lag.

### Key principles

- **Protect originals explicitly**: The source file is never modified during the editing process. Editing mistakes should be reversible.
- **Define unacceptable compromises**: Do not silently shift cuts, discard tracks or metadata, or re-encode an entire long clip to make an export succeed. Explain limitations in a brief and simple manner so non-technical users can grasp it instantly.
- **Separate preview from output**. Preview settings do not change exported content. Export changes require an explicit choice.

## Scope

The core job is extracting one or more kept ranges (referred to as "Clips") from one source video. Preserve the selected content, timing, audio tracks, color, and applicable metadata.

Multi-source projects, effects, transitions, clip rearrangement, and a general editing suite are outside the current scope. Growth needs a reason tied to the quick trimming workflow.

## Cutting expectations

Handles move freely by default. Users should get the source frames they selected without having to understand keyframes.

Re-encoding a small section near a boundary is acceptable when needed for accuracy, the rest should remain unchanged wherever possible. Keyframe snapping is an optional timeline tool for users who want to avoid boundary encoding.

## Versioning

Every push to main builds and verifies all five targets as a private candidate. To release, push the changes first, wait for that commit's `Release candidate` status to pass, then run `bun run release <major|minor|patch>`.

Always run `bun run format` and `bun run verify` after a turn with many file edits. For changes to export, playback, packaging, or release workflows, run `bun run verify:release` too. Fix local failures before pushing, then fix isolated check failures before publication.

After a version bump, watch the release through completion on all five targets. If an unpublished release fails, rerun the failed jobs or fix and retry the same version. The release workflow publishes automatically after every required check passes.

## Shared files

These files are shared line for line with AcroClip and Deduup, apart from their imports and app blocks: `src/main/update-manager.ts`, `src/main/splash.ts`, `scripts/splash/splash.cs`, `scripts/after-pack.cjs` and `scripts/release-notes.mjs`. Each app keeps its own `scripts/splash/identity.cs`. Make changes to a shared file in all three apps in the same turn.

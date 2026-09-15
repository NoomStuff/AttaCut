# AttaCut

We are building a fast, cross-platform video trimmer for getting clips out of a recording with as little effort as possible.

AttaCut combines accurate cutting with the quick trim experience of Windows Photos while preserving source quality wherever possible.

This app should combine accurate, efficient cutting with a compact interface that feels immediate.

## What we optimize for

1. **Correctness.** The exported video must match the chosen clips and original video, with working playback and synchronized audio. Preserve the source and as much of its media as possible, including all its content and metadata. A fast export with the wrong content is a failure.
2. **Speed.** Opening a recording, finding a moment, trimming, and exporting should be a short visit. Absolutely minimise load times and preload details when needed without blocking the user. Prefer a happy path where silent loads can happen in the background as the user gets instant feedback.
3. **Polish.** The preview gets the space. Controls are compact, clear, and pleasant to use. Motion should fluent while explaining a change or providing feedback without making editing lag.

### Key principles

- **Protect originals explicitly**: The source file is never modified. Editing mistakes should be reversible.
- **Define unacceptable compromises**: Do not silently shift cuts, discard tracks or metadata, or re-encode an entire long clip to make an export succeed. Explain limitations in a brief and simple manner so non-technical users can grasp it instantly.
- **Separate preview from output**. Preview settings do not change exported content. Export changes require an explicit choice.

## Scope

The core job is extracting one or more kept ranges (referred to as "Clips") from one source video. Preserve the selected content, timing, audio tracks, color, and applicable metadata. Format support means the result plays correctly and retains those properties, not merely that export finishes.

Multi-source projects, effects, transitions, clip rearrangement, and a general editing suite are outside the current scope. Growth needs a reason tied to the quick trimming workflow. Maintainability matters because improving one interaction should not destabilize another.

## Cutting expectations

Handles move freely by default. Users should get the source frames they selected without having to understand keyframes.

Re-encoding a small section near a boundary is acceptable when needed for accuracy, the rest should remain unchanged wherever possible. Keyframe snapping is an optional timeline tool for users who want to avoid boundary encoding.

## Versioning

Pushing to main with a new version number in `package.json` is what triggers a release via GitHub Actions. Bump it appropriately for the changes made, follow ups should not bump again unless pushes to main have been made since.

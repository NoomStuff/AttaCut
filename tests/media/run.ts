export {};
// These suites produce fixtures consumed by the later checks. Keep the order explicit.
await import("../create-fixtures.ts");
await import("./architecture.ts");
await import("./waveform.ts");
await import("./cut-accuracy.ts");
await import("./formats.ts");
await import("./metadata.ts");
await import("./dynamic-hdr.ts");
await import("./keyframes.ts");
await import("./cancellation.ts");
await import("./exports.ts");
await import("./joins.ts");

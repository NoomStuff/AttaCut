import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runMedia, ffmpegBase } from "../../src/main/media/process.ts";
import { probeSource } from "../../src/main/media/probe.ts";
import { analyzeCut, exportCut } from "../../src/main/media/cut.ts";
import { outputExtension } from "../../src/main/media/formats.ts";
import { frameHashes, ssimScore } from "./compare.ts";

const folder = resolve("work/formats");
await mkdir(folder, { recursive: true });
interface Fixture {
   name: string;
   extension: string;
   video: string[];
   audio?: string[];
   filter?: string;
   rate?: string;
   size?: string;
   silent?: boolean;
   /** Rewrite the finished file with an attached cover picture stream. */
   cover?: boolean;
}
const fixtures: Fixture[] = [
   { name: "h264", extension: ".mp4", video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0", "-crf", "18"] },
   {
      name: "h264-smpte170m",
      extension: ".mp4",
      video: [
         "-c:v",
         "libx264",
         "-g",
         "48",
         "-sc_threshold",
         "0",
         "-crf",
         "18",
         "-color_primaries",
         "smpte170m",
         "-color_trc",
         "smpte170m",
         "-colorspace",
         "smpte170m",
      ],
   },
   { name: "h264-5994", extension: ".mp4", rate: "60000/1001", video: ["-c:v", "libx264", "-g", "120", "-sc_threshold", "0", "-crf", "18"] },
   {
      name: "h264-fragmented",
      extension: ".mp4",
      video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0", "-crf", "18", "-movflags", "frag_keyframe+empty_moov"],
   },
   { name: "h264-silent", extension: ".mp4", silent: true, video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0", "-crf", "18"] },
   {
      name: "h264-jitter",
      extension: ".mp4",
      filter: "settb=1/1000,setpts=N/(24*TB)+0.013*sin(N)/TB",
      video: ["-c:v", "libx264", "-enc_time_base", "1:1000", "-fps_mode", "vfr", "-g", "48", "-sc_threshold", "0", "-crf", "18"],
   },
   {
      name: "h264-10bit",
      extension: ".mkv",
      video: ["-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-g", "48", "-sc_threshold", "0", "-crf", "18"],
   },
   {
      name: "h264-vfr",
      extension: ".mp4",
      filter: "select='if(lt(t,4),1,not(mod(n,2)))'",
      video: ["-c:v", "libx264", "-fps_mode", "vfr", "-g", "48", "-sc_threshold", "0", "-crf", "18"],
   },
   {
      name: "hevc-10bit",
      extension: ".mp4",
      video: [
         "-c:v",
         "libx265",
         "-pix_fmt",
         "yuv420p10le",
         "-x265-params",
         "keyint=48:min-keyint=48:scenecut=0:open-gop=0:pools=4:log-level=error",
         "-crf",
         "18",
      ],
   },
   {
      name: "hevc-jitter",
      extension: ".mkv",
      filter: "settb=1/1000,setpts=N/(24*TB)+0.013*sin(N)/TB",
      video: [
         "-c:v",
         "libx265",
         "-enc_time_base",
         "1:1000",
         "-fps_mode",
         "vfr",
         "-x265-params",
         "keyint=48:min-keyint=48:scenecut=0:open-gop=1:pools=4:log-level=error",
         "-crf",
         "18",
      ],
   },
   {
      name: "hevc-hlg",
      extension: ".mp4",
      video: [
         "-c:v",
         "libx265",
         "-pix_fmt",
         "yuv420p10le",
         "-x265-params",
         "keyint=48:min-keyint=48:scenecut=0:open-gop=0:pools=4:log-level=error:colorprim=9:transfer=18:colormatrix=9",
         "-crf",
         "18",
      ],
   },
   {
      name: "hevc-open-gop",
      extension: ".mp4",
      video: ["-c:v", "libx265", "-x265-params", "keyint=48:min-keyint=48:scenecut=0:open-gop=1:pools=4:log-level=error", "-crf", "18"],
   },
   {
      name: "hevc-hdr10",
      extension: ".mkv",
      filter: "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc",
      video: [
         "-c:v",
         "libx265",
         "-pix_fmt",
         "yuv420p10le",
         "-color_primaries",
         "bt2020",
         "-color_trc",
         "smpte2084",
         "-colorspace",
         "bt2020nc",
         "-x265-params",
         "keyint=48:min-keyint=48:scenecut=0:open-gop=0:pools=4:log-level=error:colorprim=9:transfer=16:colormatrix=9:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400",
         "-crf",
         "18",
      ],
   },
   {
      name: "vp8",
      extension: ".webm",
      video: ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-g", "48", "-b:v", "1M"],
      audio: ["-c:a", "libvorbis"],
   },
   {
      name: "vp9",
      extension: ".webm",
      video: ["-c:v", "libvpx-vp9", "-cpu-used", "5", "-g", "48", "-crf", "25", "-b:v", "0"],
      audio: ["-c:a", "libopus"],
   },
   {
      name: "vp9-10bit",
      extension: ".webm",
      video: ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p10le", "-cpu-used", "5", "-g", "48", "-crf", "25", "-b:v", "0"],
      audio: ["-c:a", "libopus"],
   },
   { name: "av1", extension: ".mp4", video: ["-c:v", "libaom-av1", "-cpu-used", "8", "-g", "48", "-crf", "25", "-b:v", "0"] },
   {
      name: "av1-10bit",
      extension: ".mkv",
      video: ["-c:v", "libaom-av1", "-pix_fmt", "yuv420p10le", "-cpu-used", "8", "-g", "48", "-crf", "25", "-b:v", "0"],
   },
   {
      name: "prores",
      extension: ".mov",
      video: ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"],
      audio: ["-c:a", "pcm_s16le"],
   },
   {
      name: "dnxhr",
      extension: ".mov",
      video: ["-c:v", "dnxhd", "-profile:v", "dnxhr_sq", "-pix_fmt", "yuv422p"],
      audio: ["-c:a", "pcm_s24le"],
   },
   { name: "mjpeg", extension: ".avi", video: ["-c:v", "mjpeg", "-q:v", "3"], audio: ["-c:a", "pcm_s16le"] },
   { name: "ffv1", extension: ".mkv", video: ["-c:v", "ffv1", "-level", "3", "-g", "1"], audio: ["-c:a", "flac"] },
   { name: "mpeg2", extension: ".mpg", video: ["-c:v", "mpeg2video", "-g", "12", "-bf", "2", "-q:v", "3"], audio: ["-c:a", "mp2"] },
   { name: "mpeg4", extension: ".avi", video: ["-c:v", "mpeg4", "-g", "48", "-bf", "2", "-q:v", "3"], audio: ["-c:a", "libmp3lame"] },
   { name: "wmv2", extension: ".wmv", video: ["-c:v", "wmv2", "-g", "48", "-q:v", "3"], audio: ["-c:a", "wmav2"] },
   { name: "transport", extension: ".ts", video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0"], audio: ["-c:a", "ac3"] },
   { name: "flv", extension: ".flv", video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0"] },
   {
      name: "h263",
      extension: ".3gp",
      size: "176x144",
      video: ["-c:v", "h263", "-g", "48", "-q:v", "3"],
      // AMR-NB would be the authentic 3gp audio, but the pinned macOS ARM ffmpeg cannot encode it.
      audio: ["-c:a", "aac", "-ar", "8000", "-ac", "1"],
   },
   { name: "msmpeg4", extension: ".avi", video: ["-c:v", "msmpeg4", "-g", "48", "-q:v", "3"], audio: ["-c:a", "wmav2"] },
   { name: "magicyuv", extension: ".mkv", video: ["-c:v", "magicyuv", "-pix_fmt", "yuv420p"], audio: ["-c:a", "flac"] },
   { name: "prores-4444", extension: ".mov", video: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuv444p10le"], audio: ["-c:a", "pcm_s16le"] },
   {
      name: "h264-interlaced",
      extension: ".mts",
      filter: "tinterlace=interleave_top",
      rate: "50",
      video: ["-c:v", "libx264", "-flags", "+ilme+ildct", "-x264-params", "tff=1", "-g", "48", "-sc_threshold", "0", "-crf", "18"],
   },
   {
      name: "dv",
      extension: ".dv",
      size: "720x480",
      rate: "30000/1001",
      video: ["-c:v", "dvvideo", "-pix_fmt", "yuv411p"],
      audio: ["-c:a", "pcm_s16le", "-ac", "2"],
   },
   {
      name: "mpeg2-interlaced",
      extension: ".mpg",
      filter: "tinterlace=interleave_top",
      rate: "50",
      video: ["-c:v", "mpeg2video", "-flags", "+ilme+ildct", "-g", "12", "-bf", "2", "-q:v", "3"],
      audio: ["-c:a", "mp2"],
   },
   { name: "cover", extension: ".mp4", video: ["-c:v", "libx264", "-g", "48", "-sc_threshold", "0", "-crf", "18"], cover: true },
];
const selected = process.env["ATTACUT_FORMATS"]?.split(",");
const outcomes: { name: string; passed: boolean; details: string }[] = [];
interface Frame {
   time: number;
   hash: string;
}
async function frames(path: string): Promise<Frame[]> {
   const text = await runMedia("ffmpeg", [
      "-v",
      "error",
      "-fflags",
      "+genpts",
      "-noautorotate",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-an",
      "-fps_mode",
      "passthrough",
      "-f",
      "framemd5",
      "-",
   ]);
   const data: { format: { start_time?: string }; frames: { best_effort_timestamp_time: string }[] } = JSON.parse(
      await runMedia("ffprobe", [
         "-v",
         "error",
         "-fflags",
         "+genpts",
         "-select_streams",
         "v:0",
         "-show_frames",
         "-show_entries",
         "format=start_time:frame=best_effort_timestamp_time",
         "-of",
         "json",
         path,
      ])
   );
   const hashes = frameHashes(text);
   assert.equal(hashes.length, data.frames.length);
   assert.ok(
      data.frames.every((frame) => Number.isFinite(Number(frame.best_effort_timestamp_time))),
      "Every reference frame needs a usable timestamp"
   );
   return data.frames.map((frame, index) => ({
      time: Number(frame.best_effort_timestamp_time) - Number(data.format.start_time || 0),
      hash: hashes[index]!,
   }));
}
for (const fixture of fixtures.filter((item) => !selected || selected.includes(item.name))) {
   try {
      const path = join(folder, fixture.name + fixture.extension);
      try {
         await readFile(path);
      } catch {
         await runMedia("ffmpeg", [
            ...ffmpegBase,
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${fixture.size ?? "320x180"}:rate=${fixture.rate ?? "24"}:duration=10`,
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=523:sample_rate=48000:duration=10",
            "-map",
            "0:v",
            ...(fixture.silent ? [] : ["-map", "1:a"]),
            ...(fixture.filter ? ["-vf", fixture.filter] : []),
            ...fixture.video,
            ...(fixture.audio ?? ["-c:a", "aac"]),
            path,
         ]);
         if (fixture.cover) {
            const picture = join(folder, `${fixture.name}-picture.mjpg`);
            await runMedia("ffmpeg", [
               ...ffmpegBase,
               "-f",
               "lavfi",
               "-i",
               `testsrc2=size=${fixture.size ?? "320x180"}:duration=0.1`,
               "-frames:v",
               "1",
               "-c:v",
               "mjpeg",
               picture,
            ]);
            const withCover = join(folder, `${fixture.name}-cover${fixture.extension}`);
            await runMedia("ffmpeg", [
               ...ffmpegBase,
               "-i",
               path,
               "-i",
               picture,
               "-map",
               "0",
               "-map",
               "1:v",
               "-c",
               "copy",
               "-disposition:v:1",
               "attached_pic",
               withCover,
            ]);
            await rm(path);
            await rename(withCover, path);
         }
      }
      const source = await probeSource(path);
      if (fixture.name === "hevc-hdr10") {
         assert.equal(source.streams[0]!.colorTransfer, "smpte2084");
         assert.equal(source.streams[0]!.maxCll, "1000,400");
         assert.ok(source.streams[0]!.masterDisplay);
      }
      if (fixture.name === "h264-interlaced") assert.equal(source.streams[0]!.fieldOrder, "tt", "interlaced fixture field order");
      const original = await frames(path);
      let detail = "";
      for (const [start, end] of [
         [1.25, 8.75],
         [0, 5.5],
         [2.2, 3.3],
         [1.25, source.duration],
      ]) {
         const analysis = await analyzeCut(source, { id: "test", color: 0, start: start!, end: end! });
         assert.notEqual(analysis.method, "unsupported", analysis.message);
         const destination = join(folder, `${fixture.name}-${start}-${end}-cut${outputExtension(source)}`);
         await rm(destination, { force: true });
         await exportCut(source, analysis, destination);
         await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", destination, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"]);
         const output = await probeSource(destination);
         const actual = await frames(destination);
         const audioTimes: { streams: { codec_type: string; start_time?: string }[] } = JSON.parse(
            await runMedia("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "json", destination])
         );
         for (const audio of audioTimes.streams.filter((stream) => stream.codec_type === "audio"))
            assert.ok(Number(audio.start_time || 0) >= -0.04 && Number(audio.start_time || 0) < 0.09, `audio start ${audio.start_time}`);
         const reference = original.filter((frame) => frame.time >= analysis.clip.start - 0.002 && frame.time < analysis.clip.end - 0.002);
         assert.equal(actual.length, reference.length, "frame count");
         let copies = 0;
         reference.forEach((frame, index) => {
            assert.ok(
               Math.abs(actual[index]!.time - (frame.time - analysis.clip.start)) < 0.006,
               `timestamp at frame ${index}: ${actual[index]!.time} != ${frame.time - analysis.clip.start}`
            );
            if (analysis.spans.some((span) => !span.encode && frame.time >= span.start - 0.002 && frame.time < span.end - 0.002)) {
               assert.equal(actual[index]!.hash, frame.hash, `copied frame ${index}`);
               copies++;
            }
         });
         assert.equal(output.streams.filter((stream) => stream.type === "audio").length, source.streams.filter((stream) => stream.type === "audio").length);
         assert.equal(
            output.streams.filter((stream) => stream.type === "subtitle").length,
            source.streams.filter((stream) => stream.type === "subtitle").length,
            "subtitle streams"
         );
         assert.equal(
            output.streams.filter((stream) => stream.type === "data").length,
            source.streams.filter((stream) => stream.type === "data").length,
            "data streams"
         );
         assert.equal(
            output.streams.filter((stream) => stream.attachedPicture).length,
            source.streams.filter((stream) => stream.attachedPicture).length,
            "cover art"
         );
         assert.equal(output.streams[0]!.pixelFormat, source.streams[0]!.pixelFormat, "pixel format");
         for (const key of ["colorTransfer", "colorPrimaries", "colorSpace", "colorRange", "rotation", "masterDisplay", "maxCll"] as const) {
            const value = source.streams[0]![key];
            if (value && value !== "unknown") assert.equal(output.streams[0]![key], value, key);
         }
         for (const boundaryIndex of [0, reference.length - 1]) {
            const originalIndex = original.indexOf(reference[boundaryIndex]!);
            const qualityPath = `work/formats/${fixture.name}-quality.txt`;
            const quality = await ssimScore({
               inputs: ["-v", "error", "-noautorotate", "-i", path, "-noautorotate", "-i", destination],
               filter: `[0:v]trim=start_frame=${originalIndex}:end_frame=${originalIndex + 1},setpts=PTS-STARTPTS[a];[1:v]trim=start_frame=${boundaryIndex}:end_frame=${boundaryIndex + 1},setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=${qualityPath}`,
               statsPath: qualityPath,
            });
            assert.ok(quality > 0.94, `boundary frame ${boundaryIndex} SSIM ${quality}`);
         }
         detail += `${actual.length} frames/${copies} copied; `;
      }
      outcomes.push({ name: fixture.name, passed: true, details: detail });
      console.log("PASS", fixture.name, detail);
   } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      outcomes.push({ name: fixture.name, passed: false, details });
      console.log("FAIL", fixture.name, details.slice(0, 1800));
   }
}
await writeFile(join(folder, "results.json"), JSON.stringify(outcomes, null, 2));
assert.ok(outcomes.length && outcomes.every((item) => item.passed), "Some format checks failed. See work/formats/results.json.");

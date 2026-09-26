# Format support in 0.11.0

Tested on Windows with Electron 44.4.5 and the pinned FFmpeg builds: 8.1.2 on Windows and Linux, 9.0.2 on macOS. The app uses FFmpeg to read the source and export clips. Chromium handles playback when it can; a temporary compatible preview handles the other tested formats.

## Verified video combinations

| Video         | Tested input containers and variants                                                                                 | Partial export                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| H.264 / AVC   | MP4, fragmented MP4, MKV, MPEG-TS, FLV, MTS; 8/10-bit, 24/59.94 fps, variable timing, silent video, interlaced 1080i | Copy the middle, encode boundaries                                                    |
| HEVC / H.265  | MP4, MKV; 8/10-bit, open GOPs, variable timing, HDR10 and HLG                                                        | Copy the middle, encode boundaries; retain supported HDR color and mastering metadata |
| VP8           | WebM with Vorbis                                                                                                     | Copy the middle, encode boundaries                                                    |
| VP9           | WebM with Opus; 8/10-bit                                                                                             | Copy the middle, encode boundaries                                                    |
| AV1           | MP4 with AAC, MKV with AAC; 8/10-bit SDR                                                                             | Copy the middle, encode boundaries                                                    |
| ProRes        | MOV, 10-bit 4:2:2 and 4:4:4, PCM audio                                                                               | Copy every video frame                                                                |
| DNxHR         | MOV, 4:2:2, 24-bit PCM audio                                                                                         | Copy every video frame                                                                |
| MJPEG         | AVI with PCM audio                                                                                                   | Copy every video frame; export MKV                                                    |
| FFV1          | MKV, independent frames, FLAC audio                                                                                  | Copy every video frame                                                                |
| MagicYUV      | MKV, yuv420p                                                                                                         | Copy every video frame                                                                |
| MPEG-2        | MPG with MP2, regular timing and B-frames; interlaced                                                                | Copy the middle, encode boundaries; export MKV                                        |
| MPEG-4 Part 2 | AVI with MP3 and B-frames, regular timing                                                                            | Short precise clips can require encoding the entire clip; export MKV                  |
| MSMPEG4v3     | AVI with WMA                                                                                                         | Copy the middle, encode boundaries; export MKV                                        |
| H.263         | 3GP with AMR-NB audio, QCIF size                                                                                     | Copy the middle, encode boundaries; export MKV                                        |
| DV            | DV container, 720x480 with PCM audio                                                                                 | Copy every video frame; export MKV                                                    |
| WMV2          | WMV with WMA, regular timing                                                                                         | Copy the middle, encode boundaries; export MKV                                        |

MP4, MOV, M4V, MKV, and WebM retain their container for partial exports. Other input containers use MKV to avoid unreliable timing in legacy muxers. The export panel shows the resulting extension. An unchanged full-file export copies the original file directly, including its container and all streams.

## Codecs without a boundary encoder

Some codecs decode but have no FFmpeg encoder, so a cut across non-keyframe boundaries cannot re-encode just the edge section. WMV3/WMV9 and VC-1, Theora, VP6, RealVideo, and Indeo behave this way. These files open, preview, and export losslessly; turn on **Snap to keyframes** so both cut points land on a keyframe and the whole clip is stream-copied. The export panel shows this option when a codec needs it.

## Stream preservation

- GoPro-style telemetry data tracks (gpmd, timecode) are copied into MP4-family outputs and left out of MKV outputs, which cannot store them. The export panel says so before any export starts.
- Bitmap subtitles (PGS, VobSub, DVB) are copied, time-shifted, into MKV outputs. Text subtitles convert as before. MP4 cannot store bitmap subtitles.
- Embedded cover pictures are preserved on partial exports and combined exports are refused for them.
- Chapters, text metadata, rotation, HDR mastering metadata, and multiple audio tracks are preserved as in earlier versions.

## Accepted containers

The file picker and file associations accept MP4, MOV, M4V, MKV, WebM, AVI, MPEG-TS and variants (TS, MTS, M2TS, M2T), MPEG program streams (MPG, MPEG, M2V, M1V, VOB, M2P, MOD, TOD, VRO), ASF family (WMV, ASF, DVR-MS, WTV), Flash (FLV, F4V), Ogg (OGV, OGM), MXF, 3GP/3G2, DV, DIVX, MJPG, and raw elementary streams (H264, 264, H265, 265, HEVC). Dragging a file onto the window bypasses the extension list entirely; opening is decided by the file's contents. Listing an extension means the app can try opening it. It does not establish support for every codec, profile, or track combination inside that container, and the exotic containers beyond those in the verified table have not all been exercised with representative recordings.

Long recordings index keyframes without reading the whole file for MP4/MOV (sample tables) and for MKV/WebM (Cues); other containers scan packets as a stream, which no longer has a size cap. MP4/MOV sources also index every frame timestamp once at open, so scrubbing and frame stepping resolve from memory anywhere in a multi-hour recording; other containers read a short packet window per new region and extend it when widely spaced keyframes require more data. Previews for sources that Chromium cannot play are generated with hardware-accelerated decoding when available, deinterlaced for viewing when the source is interlaced, and stay inside a 4 GB cache budget (sources over two hours get a lighter proxy).

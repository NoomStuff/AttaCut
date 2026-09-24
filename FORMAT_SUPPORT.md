# Format support in 0.9.0

Tested on Windows with Electron 44.4.5 and the pinned FFmpeg builds: 8.1.2 on Windows and Linux, 9.0.2 on macOS. The app uses FFmpeg to read the source and export clips. Chromium handles playback when it can; a temporary compatible preview handles the other tested formats.

## Verified video combinations

| Video         | Tested input containers and variants                                                          | Partial export                                                                        |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| H.264 / AVC   | MP4, fragmented MP4, MKV, MPEG-TS, FLV; 8/10-bit, 24/59.94 fps, variable timing, silent video | Copy the middle, encode boundaries                                                    |
| HEVC / H.265  | MP4, MKV; 8/10-bit, open GOPs, variable timing, HDR10 and HLG                                 | Copy the middle, encode boundaries; retain supported HDR color and mastering metadata |
| VP8           | WebM with Vorbis                                                                              | Copy the middle, encode boundaries                                                    |
| VP9           | WebM with Opus; 8/10-bit                                                                      | Copy the middle, encode boundaries                                                    |
| AV1           | MP4 with AAC, MKV with AAC; 8/10-bit SDR                                                      | Copy the middle, encode boundaries                                                    |
| ProRes        | MOV, 10-bit 4:2:2, PCM audio                                                                  | Copy every video frame                                                                |
| DNxHR         | MOV, 4:2:2, 24-bit PCM audio                                                                  | Copy every video frame                                                                |
| MJPEG         | AVI with PCM audio                                                                            | Copy every video frame; export MKV                                                    |
| FFV1          | MKV, independent frames, FLAC audio                                                           | Copy every video frame                                                                |
| MPEG-2        | MPG with MP2, regular timing and B-frames                                                     | Copy the middle, encode boundaries; export MKV                                        |
| MPEG-4 Part 2 | AVI with MP3 and B-frames, regular timing                                                     | Short precise clips can require encoding the entire clip; export MKV                  |
| WMV2          | WMV with WMA, regular timing                                                                  | Copy the middle, encode boundaries; export MKV                                        |

MP4, MOV, M4V, MKV, and WebM retain their container for partial exports. Other input containers use MKV to avoid unreliable timing in legacy muxers. The export panel shows the resulting extension. An unchanged full-file export copies the original file directly, including its container and all streams.

The file picker also accepts related extensions including MTS, M2TS, MPEG, M2V, VOB, ASF, OGV, and MXF. Listing an extension means the app can try opening it. It does not establish support for every codec, profile, or track combination inside that container. These additional containers have not all been exercised with representative recordings.

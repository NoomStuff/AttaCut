import { useExport, type ExportOptions } from "../export/useExport";
import { substantialEncoding } from "../../../shared/export-policy";
import type { HelpTab } from "./HelpPanel";
import { useEffect, useState } from "react";
import { containerNames, exportRotations } from "../../../shared/export-format";
import type { ContainerChoice, ExportRotation } from "../../../shared/export-format";
import type { MediaStream } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { sanitizeName } from "../../../shared/filename";
import { faArrowUpFromBracket, faChevronDown, faCircleExclamation, faCircleInfo, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { OutputDirectoryField } from "./OutputDirectoryField";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, Modal, Toggle } from "./Controls";
import { DropdownSelect } from "./DropdownSelect";
import { SegmentedControl } from "./SegmentedControl";
import { errorText } from "../lib/errors";
import { clipColor } from "../editor/colors";
import { audioTrackLabel } from "../playback/audioSelection";
import { coverageChange } from "../export/exportClips";
import { primaryVideo } from "../../../shared/media";

function streamLabel(stream: MediaStream, index: number): string {
   const detail = [stream.title, stream.language && stream.language !== "und" ? stream.language : ""].filter(Boolean).join(", ");
   const kind =
      stream.type === "subtitle"
         ? "Subtitles"
         : stream.type === "data"
           ? "Telemetry"
           : stream.type === "attachment"
             ? "Attachment"
             : stream.attachedPicture
               ? "Cover picture"
               : `Track ${index + 1}`;
   return `${kind}${detail ? ` · ${detail}` : ""} (${stream.codec})`;
}
function seconds(value: number): string {
   return value < 0.1 ? "less than 0.1 s" : `${value.toFixed(1)} s`;
}

export function ExportPanel(props: ExportOptions & { onHelp?: (topic: HelpTab) => void }) {
   const { source, onClose, onHelp } = props;
   const {
      sourceAudio,
      otherStreams,
      directory,
      setDirectory,
      mode,
      setMode,
      singleTarget,
      audioTracks,
      setAudioTracks,
      excludedStreams,
      setExcludedStreams,
      rotation,
      setRotation,
      gaps,
      setGaps,
      container,
      setContainer,
      choices,
      combinedExtension,
      extensionFor,
      lossless,
      setLossless,
      clipChapters,
      setClipChapters,
      advanced,
      setAdvanced,
      name,
      setName,
      setRowName,
      setIncluded,
      normalizeName,
      rows,
      confirmation,
      setConfirmation,
      replaceSourceChecked,
      setReplaceSourceChecked,
      conflicts,
      dangers,
      collisions,
      nameErrors,
      request,
      error,
      setError,
      starting,
      analysis,
      selectedCount,
      valid,
      start,
   } = useExport(props);
   const confirmationModal = confirmation ? (
      <Modal
         key="confirmation"
         closeDisabled={starting}
         title={
            confirmation.directoryMissing
               ? "Create output folder?"
               : confirmation.sourcePath
                 ? "Replace source video?"
                 : confirmation.existingPaths.length === 1
                   ? "Replace existing file?"
                   : confirmation.existingPaths.length
                     ? "Replace existing files?"
                     : confirmation.items.some(substantialEncoding)
                       ? "Re-encode selected video?"
                       : "Export with media changes?"
         }
         onClose={() => setConfirmation(null)}
         className="export-confirmation"
      >
         <div className="modal-body">
            <p>
               {confirmation.directoryMissing
                  ? `This folder does not exist. Create it and export ${mode === "combined" ? "the video" : selectedCount === 1 ? "the clip" : "the clips"}?`
                  : confirmation.sourcePath
                    ? `This will replace the video you opened. The original cannot be recovered. The exported video will open when it is ready.${confirmation.existingPaths.length > 1 ? " Other listed files will also be replaced." : ""}`
                    : confirmation.existingPaths.length === 1
                      ? "This file already exists. Exporting will replace it. This cannot be undone."
                      : confirmation.existingPaths.length
                        ? "These files already exist. Exporting will replace them. This cannot be undone."
                        : confirmation.items.some(substantialEncoding)
                          ? "These cuts need more than a small section re-encoded."
                          : "This output format cannot preserve all source media."}
            </p>
            {confirmation.items.some(substantialEncoding) && (
               <p>Part of the selected video will be re-encoded. This takes longer and may reduce quality. Snap the cuts to keyframes to avoid it.</p>
            )}
            {[...new Set(confirmation.items.flatMap((item) => item.changes ?? []))].map((change) => (
               <p key={change}>{change}</p>
            ))}
            <div className="export-conflicts">
               {confirmation.directoryMissing ? confirmation.directory : confirmation.existingPaths.map((path) => <div key={path}>{path}</div>)}
            </div>
            {confirmation.sourcePath && (
               <label className="export-source-confirm">
                  <input
                     type="checkbox"
                     checked={replaceSourceChecked}
                     disabled={starting}
                     onChange={(event) => setReplaceSourceChecked(event.target.checked)}
                  />
                  I understand this replaces the original video
               </label>
            )}
         </div>
         <div className="modal-footer">
            <Button disabled={starting} onClick={() => setConfirmation(null)}>
               Cancel
            </Button>
            <Button
               variant={
                  confirmation.sourcePath ||
                  confirmation.existingPaths.length ||
                  confirmation.items.some(substantialEncoding) ||
                  confirmation.items.some((item) => item.changes?.length)
                     ? "danger"
                     : "primary"
               }
               disabled={starting || (!!confirmation.sourcePath && !replaceSourceChecked)}
               onClick={() => {
                  void start(confirmation);
               }}
            >
               {starting
                  ? "Exporting…"
                  : confirmation.directoryMissing
                    ? "Create folder and export"
                    : confirmation.sourcePath
                      ? "Replace source and export"
                      : confirmation.existingPaths.length
                        ? "Replace and export"
                        : confirmation.items.some(substantialEncoding)
                          ? "Re-encode and export"
                          : "Export"}
            </Button>
         </div>
      </Modal>
   ) : null;
   const includedIds = new Set(rows.filter((row) => row.included).map((row) => row.clip.id));
   const checked = analysis?.filter((item) => includedIds.has(item.clip.id)) ?? [];
   const problem = checked.find((item) => item.method === "unsupported");
   const encoded = checked.reduce((sum, item) => sum + item.encodedSeconds, 0);
   const encodedLabel = (seconds: number) => (seconds < 0.1 ? "less than 0.1 seconds" : `${seconds.toFixed(1)} seconds`);
   // One clip spanning the whole source with every audio track kept is the original video,
   // so say that instead of the generic lossless note.
   const unchangedVideo =
      !problem &&
      checked.length === 1 &&
      checked[0]?.method === "copy" &&
      Math.abs(checked[0].clip.start) < 0.001 &&
      Math.abs(checked[0].clip.end - source.duration) < 0.001 &&
      sourceAudio.every((stream) => audioTracks.includes(stream.index));
   // Force lossless moves cuts to keyframes. Say how much that adds or drops, ignoring the
   // sub-frame rounding every export does.
   const frameRate = primaryVideo(source)?.frameRate ?? 0;
   const shift =
      lossless && !problem && checked.length
         ? coverageChange(
              rows.filter((row) => row.included).map((row) => row.clip),
              checked.map((item) => item.clip)
           )
         : null;
   const visibleShift = (value: number) => value > Math.max(0.005, frameRate > 0 ? 0.5 / frameRate : 0);
   const shiftNote =
      shift && (visibleShift(shift.added) || visibleShift(shift.dropped))
         ? `Cuts move to keyframes: ${[
              visibleShift(shift.added) ? `adds ${seconds(shift.added)}` : "",
              visibleShift(shift.dropped) ? `drops ${seconds(shift.dropped)}` : "",
           ]
              .filter(Boolean)
              .join(", ")}.`
         : null;
   const baseNote = problem
      ? problem.message
      : unchangedVideo
        ? "Exporting the video unchanged."
        : encoded > 0
          ? `${encoded < 0.1 ? "Less than 0.1 seconds" : `~${encodedLabel(encoded)}`} near your cuts may be re-encoded.`
          : "Exporting losslessly.";
   const changes = [...new Set(checked.flatMap((item) => item.changes ?? []))];
   // What the export adds, drops or converts reads in yellow after the usual note.
   const noteChanges = problem ? "" : [shiftNote ?? "", ...changes].filter(Boolean).join(" ");
   const keptOther = otherStreams.filter((stream) => !excludedStreams.includes(stream.index));
   const formatLabel = (value: ContainerChoice) =>
      value === "auto"
         ? source.exportExtension === source.extension.toLowerCase()
            ? `Same as source (${source.exportExtension})`
            : `Automatic (${source.exportExtension})`
         : `${containerNames[value]} (${value})`;
   const advancedSummary = [
      lossless ? "Force lossless" : "",
      rotation ? `Rotate ${rotation}°` : "",
      gaps ? "Gaps between clips" : "",
      excludedStreams.length ? `${excludedStreams.length} ${excludedStreams.length === 1 ? "track" : "tracks"} off` : "",
      mode === "combined" && clipChapters && !singleTarget ? "Clip chapters" : "",
   ]
      .filter(Boolean)
      .join(", ");
   const itemLabel = gaps ? "Part" : "Clip";
   return (
      <>
         <Modal
            key="options"
            closeDisabled={starting}
            title={mode === "combined" ? "Export video" : selectedCount === 1 ? "Export clip" : "Export clips"}
            onClose={() => {
               if (!starting) onClose();
            }}
            className="export-modal"
         >
            <div className="modal-body">
               <SegmentedControl
                  className="export-mode"
                  label="Export mode"
                  value={mode}
                  onChange={setMode}
                  disabled={starting || singleTarget}
                  options={[
                     { value: "combined", label: "Single Video" },
                     { value: "separate", label: "Separate Clips" },
                  ]}
               />
               <label className="field-label" htmlFor="destination">
                  Save to
               </label>
               <OutputDirectoryField
                  id="destination"
                  className="folder-field"
                  value={directory}
                  disabled={starting}
                  onChange={setDirectory}
                  onError={(value) => setError(errorText(value))}
               />
               <div>
                  {mode === "combined" && (
                     <label className="field-label combined-name">
                        Filename
                        <div className="filename-field">
                           <span className="export-name-input">
                              <input
                                 aria-label="Combined filename"
                                 aria-invalid={nameErrors.has("combined")}
                                 value={name}
                                 disabled={starting}
                                 onBlur={() => normalizeName()}
                                 onChange={(event) => setName(event.target.value)}
                              />
                              <ConflictIndicator
                                 message={nameErrors.get("combined") ?? conflicts.get("combined") ?? null}
                                 tone={nameErrors.has("combined") || dangers.get("combined") ? "danger" : "warning"}
                              />
                           </span>
                           <span className="filename-extension">{combinedExtension}</span>
                        </div>
                     </label>
                  )}
               </div>
               {sourceAudio.length === 1 && (
                  <Toggle
                     label="Export audio"
                     checked={audioTracks.length === 1}
                     disabled={starting}
                     onChange={(checked) => setAudioTracks(checked ? [sourceAudio[0]!.index] : [])}
                  />
               )}
               {sourceAudio.length > 1 && (
                  <div className="audio-export-field">
                     <span className="field-label">Audio tracks</span>
                     <DropdownSelect
                        label="Audio tracks to export"
                        options={sourceAudio.map((track, index) => ({ value: String(track.index), label: audioTrackLabel(track, index) }))}
                        value={audioTracks.map(String)}
                        multiple
                        disabled={starting}
                        onChange={(values) => setAudioTracks(values.map(Number))}
                        trigger={
                           audioTracks.length === sourceAudio.length
                              ? "All audio tracks"
                              : audioTracks.length === 1
                                ? audioTrackLabel(
                                     sourceAudio.find((track) => track.index === audioTracks[0])!,
                                     sourceAudio.findIndex((track) => track.index === audioTracks[0])
                                  )
                                : `${audioTracks.length} audio tracks`
                        }
                     />
                  </div>
               )}
               {choices.length > 0 && (
                  <div className="export-format-field">
                     <span className="field-label">Format</span>
                     <DropdownSelect
                        label="Export format"
                        options={(["auto", ...choices] as const).map((value) => ({ value, label: formatLabel(value) }))}
                        value={[container]}
                        required
                        disabled={starting}
                        onChange={(values) => setContainer((values[0] as ContainerChoice | undefined) ?? "auto")}
                        trigger={formatLabel(container)}
                     />
                  </div>
               )}
               <div className="export-advanced" data-open={advanced}>
                  <button type="button" className="export-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
                     <FontAwesomeIcon className="export-advanced-chevron" icon={faChevronDown} />
                     <span>Advanced</span>
                     {advancedSummary && <span className="export-advanced-summary">{advancedSummary}</span>}
                  </button>
                  {advanced && (
                     <div className="export-advanced-body">
                        <Toggle
                           label="Force lossless export"
                           description="Never re-encode. Cuts move to the nearest keyframes and the result is checked against the source."
                           checked={lossless}
                           disabled={starting}
                           onChange={setLossless}
                        />
                        <Toggle
                           label="Export the gaps instead"
                           description="Keep everything outside your clips."
                           checked={gaps}
                           disabled={starting}
                           onChange={setGaps}
                        />
                        {mode === "combined" && !singleTarget && (
                           <Toggle
                              label="Chapter for each clip"
                              description="Replaces the source chapters."
                              checked={clipChapters}
                              disabled={starting}
                              onChange={setClipChapters}
                           />
                        )}
                        <div className="export-advanced-field">
                           <span className="field-label">Rotate clockwise</span>
                           <SegmentedControl
                              label="Rotate clockwise"
                              value={String(rotation)}
                              disabled={starting}
                              onChange={(value) => setRotation(Number(value) as ExportRotation)}
                              options={exportRotations.map((value) => ({ value: String(value), label: value ? `${value}°` : "None" }))}
                           />
                        </div>
                        {otherStreams.length > 0 && (
                           <div className="export-advanced-field">
                              <span className="field-label">Other tracks</span>
                              <DropdownSelect
                                 label="Other tracks to export"
                                 options={otherStreams.map((stream, index) => ({ value: String(stream.index), label: streamLabel(stream, index) }))}
                                 value={keptOther.map((stream) => String(stream.index))}
                                 multiple
                                 disabled={starting}
                                 onChange={(values) =>
                                    setExcludedStreams(otherStreams.filter((stream) => !values.includes(String(stream.index))).map((stream) => stream.index))
                                 }
                                 trigger={
                                    keptOther.length === otherStreams.length
                                       ? "All kept"
                                       : keptOther.length === 0
                                         ? "None"
                                         : `${keptOther.length} of ${otherStreams.length} kept`
                                 }
                              />
                           </div>
                        )}
                     </div>
                  )}
               </div>
               {rows.length > 1 && (
                  <div className="export-list">
                     <div className="export-list-heading">
                        <span>{gaps ? "Gaps" : "Clips"}</span>
                        <span>Duration</span>
                     </div>
                     {rows.map((row, index) => {
                        const extension = extensionFor(row.clip, mode === "separate");
                        // A batch collision outranks a disk conflict: it must be fixed before
                        // Export unlocks, while a replace can still be confirmed.
                        const collides = mode === "separate" && row.included && collisions.has(sanitizeName(row.name).toLowerCase());
                        const conflict =
                           nameErrors.get(row.clip.id) ??
                           (collides ? "Another clip exports to this name" : mode === "separate" && row.included ? (conflicts.get(row.clip.id) ?? null) : null);
                        const tone = nameErrors.has(row.clip.id) || collides || dangers.get(row.clip.id) ? "danger" : "warning";
                        return (
                           <div key={row.clip.id} className="export-clip-entry" data-included={row.included}>
                              <div className="export-row">
                                 <input
                                    type="checkbox"
                                    aria-label={`Export ${itemLabel.toLowerCase()} ${index + 1}`}
                                    checked={row.included}
                                    disabled={starting}
                                    onChange={(event) => setIncluded(index, event.target.checked)}
                                 />
                                 <span className="color-dot" style={{ background: clipColor(row.clip.color) }} />
                                 {mode === "combined" ? (
                                    <span className="export-clip-name">
                                       {itemLabel} {index + 1}
                                    </span>
                                 ) : (
                                    <span className="export-row-name-input">
                                       <input
                                          aria-label={`${itemLabel} ${index + 1} filename`}
                                          aria-invalid={nameErrors.has(row.clip.id)}
                                          value={row.name}
                                          onBlur={() => normalizeName(index)}
                                          disabled={starting}
                                          onChange={(event) => setRowName(index, event.target.value)}
                                       />
                                       <ConflictIndicator message={conflict} tone={tone} />
                                    </span>
                                 )}
                                 <span className="extension">{mode === "separate" ? extension : ""}</span>
                                 <time>{formatTime(row.clip.end - row.clip.start)}</time>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}
               {error && (
                  <div className="inline-error" role="alert">
                     {error}
                  </div>
               )}
            </div>
            <div className="modal-footer">
               <div className="export-summary">
                  {collisions.size > 0 && (
                     <p className="export-note problem" role="alert">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>Some clips export to the same file name. Give each clip its own name.</span>
                     </p>
                  )}
                  {analysis && request.items.length > 0 && (
                     <p className={`export-note${problem ? " problem" : checked.some(substantialEncoding) ? " warning" : ""}`}>
                        <FontAwesomeIcon icon={problem ? faCircleExclamation : faCircleInfo} />
                        <span>
                           {baseNote} {noteChanges && <span className="export-note-change">{noteChanges} </span>}
                           <button
                              className="export-note-link"
                              onClick={() => {
                                 onHelp?.(problem || checked.some(substantialEncoding) || changes.length ? "export" : "lossless");
                              }}
                           >
                              Learn More
                           </button>
                        </span>
                     </p>
                  )}
               </div>
               <Button
                  variant="primary"
                  icon={faArrowUpFromBracket}
                  disabled={starting || !valid || !!problem}
                  onClick={() => {
                     void start();
                  }}
               >
                  {starting ? "Exporting…" : mode === "combined" ? "Export video" : selectedCount === 1 ? "Export clip" : `Export ${selectedCount} clips`}
               </Button>
            </div>
         </Modal>
         {confirmationModal}
      </>
   );
}

function ConflictIndicator({ message, tone = "warning" }: { message: string | null; tone?: "warning" | "danger" }) {
   const [hasAppeared, setHasAppeared] = useState(!!message);
   useEffect(() => {
      if (message) setHasAppeared(true);
   }, [message]);
   return (
      <span
         className="export-conflict-indicator"
         data-state={message ? "visible" : hasAppeared ? "leaving" : "hidden"}
         data-tone={tone}
         role="img"
         aria-label={message ?? undefined}
         aria-hidden={!message}
         tabIndex={message ? 0 : -1}
      >
         <FontAwesomeIcon icon={tone === "danger" ? faTriangleExclamation : faCircleExclamation} />
         {message && (
            <span className="export-conflict-tooltip" role="tooltip">
               {message}
            </span>
         )}
      </span>
   );
}

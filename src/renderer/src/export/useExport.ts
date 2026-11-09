import { audioStreams } from "../../../shared/media";
import { useCallback, useEffect, useMemo, useState } from "react";
import { substantialEncoding } from "../../../shared/export-policy";
import { applyNamePattern, duplicateNames, filenameError } from "../../../shared/filename";
import { containerChoices, exportExtensionFor } from "../../../shared/export-format";
import type { ContainerChoice } from "../../../shared/export-format";
import type { Clip, ExportJob, ExportPlan, CutReport, MediaSource, MediaStream, Preferences } from "../../../shared/types";
import { errorText, isCancellation } from "../lib/errors";
import { rememberAudioSelection, resolveAudioSelection } from "../playback/audioSelection";

export interface ExportDraft {
   sourceId: string;
   directory: string;
   mode: Preferences["exportMode"];
   audioTracks: number[];
   excludedStreams: number[];
   name: string;
   nameAltered: boolean;
   rows: { clipId: string; included: boolean; name: string; altered: boolean }[];
}

export interface ExportOptions {
   source: MediaSource;
   draft: ExportDraft | null;
   onDraft: (draft: ExportDraft) => void;
   clips: Clip[];
   preferences: Preferences;
   onPreferences: (value: Preferences | ((current: Preferences) => Preferences)) => void;
   onClose: () => void;
   onStarted: (job: ExportJob) => void;
   onBeforeSourceReplace: () => Promise<void>;
   onSourceReplaceStartFailed: () => void;
}

/** Streams besides the picture and audio that an export can leave out. */
export function optionalStreams(source: MediaSource): MediaStream[] {
   return source.streams.filter(
      (stream) => (["subtitle", "data", "attachment"].includes(stream.type) && !stream.chapterTrack) || (stream.type === "video" && stream.attachedPicture)
   );
}

interface RowState {
   included: boolean;
   /** Null follows the name template. A string, even empty while typing, is the user's own name. */
   name: string | null;
}

export function useExport({
   source,
   draft,
   onDraft,
   clips,
   preferences,
   onPreferences,
   onClose,
   onStarted,
   onBeforeSourceReplace,
   onSourceReplaceStartFailed,
}: ExportOptions) {
   const saved = draft?.sourceId === source.id ? draft : null;
   const sourceAudio = audioStreams(source);
   const [directory, setDirectory] = useState(saved?.directory ?? (preferences.outputDirectory || source.directory));
   const [audioTracks, updateAudioTracks] = useState(saved?.audioTracks ?? resolveAudioSelection(sourceAudio, preferences.exportAudio, true));
   const setAudioTracks = (selected: number[]) => {
      updateAudioTracks(selected);
      onPreferences((current) => ({ ...current, exportAudio: rememberAudioSelection(sourceAudio, selected, true) }));
   };
   const otherStreams = optionalStreams(source);
   const [excludedStreams, setExcludedStreams] = useState<number[]>(
      () => saved?.excludedStreams.filter((index) => otherStreams.some((stream) => stream.index === index)) ?? []
   );
   // The automatic container is already the first choice, so it is not listed twice.
   const choices = containerChoices(source).filter((value) => value !== source.exportExtension);
   // A remembered container this video cannot use falls back to automatic, without changing the preference.
   const container: ContainerChoice =
      preferences.exportContainer !== "auto" && choices.includes(preferences.exportContainer) ? preferences.exportContainer : "auto";
   const setContainer = (value: ContainerChoice) => onPreferences((current) => ({ ...current, exportContainer: value }));
   const lossless = preferences.exportLossless;
   const setLossless = (value: boolean) => onPreferences((current) => ({ ...current, exportLossless: value }));
   const clipChapters = preferences.exportClipChapters;
   const setClipChapters = (value: boolean) => onPreferences((current) => ({ ...current, exportClipChapters: value }));
   const advanced = preferences.exportAdvanced;
   const setAdvanced = (value: boolean) => onPreferences((current) => ({ ...current, exportAdvanced: value }));
   const [mode, setMode] = useState<Preferences["exportMode"]>(clips.length === 1 ? "combined" : (saved?.mode ?? preferences.exportMode));
   const singleTarget = clips.length <= 1;
   const effectiveMode = singleTarget ? "combined" : mode;
   const unchanged = audioTracks.length === sourceAudio.length && !excludedStreams.length;
   const sourceStem = source.name.slice(0, -source.extension.length);
   // The patterns from settings are defaults: every output name follows its template until
   // it is edited by hand, and clearing a field hands the name back to the template. So a
   // template change in settings reaches every name that was never touched.
   const [openedAt] = useState(() => new Date());
   const patternDefaults = { source: sourceStem, total: source.duration, date: openedAt };
   const generatedCombined = () =>
      applyNamePattern(preferences.combinedNamePattern, {
         ...patternDefaults,
         index: 0,
         count: 1,
         start: Math.min(...clips.map((clip) => clip.start)),
         end: Math.max(...clips.map((clip) => clip.end)),
      });
   const [combinedName, setCombinedNameState] = useState<string | null>(saved?.nameAltered && saved.name ? saved.name : null);
   const name = combinedName ?? generatedCombined();
   const nameAltered = combinedName !== null && combinedName.trim() !== "";
   const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
      Object.fromEntries((saved?.rows ?? []).map((row) => [row.clipId, { included: row.included, name: row.altered && row.name ? row.name : null }]))
   );
   const rows = useMemo(
      () =>
         clips.map((clip, index) => {
            const state = rowStates[clip.id];
            return {
               clip,
               included: state?.included ?? true,
               altered: state?.name !== null && state?.name !== undefined && state.name.trim() !== "",
               name:
                  state?.name ??
                  applyNamePattern(preferences.clipNamePattern, {
                     source: sourceStem,
                     total: source.duration,
                     date: openedAt,
                     index,
                     count: clips.length,
                     start: clip.start,
                     end: clip.end,
                  }),
            };
         }),
      [clips, rowStates, preferences.clipNamePattern, sourceStem, source.duration, openedAt]
   );
   const updateRow = (id: string, change: Partial<RowState>) =>
      setRowStates((current) => ({ ...current, [id]: { included: current[id]?.included ?? true, name: current[id]?.name ?? null, ...change } }));
   const setIncluded = (index: number, included: boolean) => updateRow(rows[index]!.clip.id, { included });
   // An emptied field stays empty while typing (clearing to retype must not snap back);
   // leaving the field empty is what hands the name to the template, on blur.
   const setRowName = (index: number, value: string) => updateRow(rows[index]!.clip.id, { name: value });
   const setCombinedName = (value: string) => setCombinedNameState(value);
   useEffect(() => {
      onDraft({
         sourceId: source.id,
         directory,
         mode: clips.length === 1 ? preferences.exportMode : mode,
         audioTracks,
         excludedStreams,
         name,
         nameAltered,
         rows: rows.map(({ clip, included, name, altered }) => ({ clipId: clip.id, included, name, altered })),
      });
   }, [source.id, directory, mode, clips.length, preferences.exportMode, audioTracks, excludedStreams, name, nameAltered, rows, onDraft]);
   // A single clip requires combined mode but must not overwrite the multi-clip preference.
   useEffect(() => {
      if (!singleTarget) onPreferences((current) => (current.exportMode === mode ? current : { ...current, exportMode: mode }));
   }, [singleTarget, mode, onPreferences]);
   const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
   // Only an empty field hands the name back to its template on blur.
   // Invalid names stay visible until the user corrects them.
   const normalizeName = (index?: number) => {
      if (index === undefined) {
         if (name.trim() === "") setCombinedNameState(null);
         return;
      }
      const row = rows[index];
      if (row && row.name.trim() === "") updateRow(row.clip.id, { name: null });
   };
   const [replaceSourceChecked, setReplaceSourceChecked] = useState(false);
   const [conflicts, setConflicts] = useState<Map<string, string | null>>(() => new Map());
   const [dangers, setDangers] = useState<Map<string, boolean>>(() => new Map());
   const includedRows = useMemo(() => rows.filter((row) => row.included), [rows]);
   // Batch-internal name collisions are computed live: two clips headed for one file would
   // overwrite each other, which no confirmation should ever have to referee.
   const collisions = useMemo(
      () => (effectiveMode === "separate" ? duplicateNames(includedRows.map((row) => row.name)) : new Set<string>()),
      [effectiveMode, includedRows]
   );
   const output = useMemo(
      () => ({
         audioTracks,
         excludedStreams,
         container,
         lossless,
         clipChapters: effectiveMode === "combined" && clipChapters,
      }),
      [audioTracks, excludedStreams, container, lossless, effectiveMode, clipChapters]
   );
   const request = useMemo(
      () => ({
         sourceId: source.id,
         directory,
         mode: effectiveMode,
         name,
         ...output,
         items: includedRows.map((row, index) => ({
            clip: row.clip,
            name: effectiveMode === "combined" ? `Clip ${index + 1}` : row.name,
         })),
      }),
      [source.id, directory, effectiveMode, name, output, includedRows]
   );
   const [error, setError] = useState<string | null>(null);
   const [starting, setStarting] = useState(false);
   const [analysis, setAnalysis] = useState<CutReport[] | null>(null);
   const selectedCount = request.items.length;
   const extensionFor = useCallback(
      (clip: Clip, separate: boolean) => exportExtensionFor(source, clip, { separate, unchanged, container }),
      [source, unchanged, container]
   );
   const combinedExtension = container === "auto" ? source.exportExtension : container;
   const nameErrors = new Map<string, string>();
   if (effectiveMode === "combined") {
      const message = filenameError(name, combinedExtension);
      if (message) nameErrors.set("combined", message);
   } else {
      for (const row of includedRows) {
         const message = filenameError(row.name, extensionFor(row.clip, true));
         if (message) nameErrors.set(row.clip.id, message);
      }
   }
   const selectedKey = JSON.stringify(includedRows.map((row) => row.clip));
   // Typing a filename must not restart media analysis, so the ranges are compared by value.
   const selectedClips = useMemo(() => JSON.parse(selectedKey) as Clip[], [selectedKey]);
   // Media analysis is independent of filenames and destination checks, and reused at export.
   useEffect(() => {
      let cancelled = false;
      setAnalysis(null);
      if (!selectedClips.length) return;
      window.desktop
         .analyzeExport({
            sourceId: source.id,
            mode: effectiveMode,
            ...output,
            items: selectedClips.map((clip) => ({ clip, name: "clip" })),
         })
         .then((items) => {
            if (!cancelled) setAnalysis(items);
         })
         .catch((value: unknown) => {
            if (!cancelled && !isCancellation(errorText(value))) setError(errorText(value));
         });
      return () => {
         cancelled = true;
         void window.desktop.cancelExportAnalysis();
      };
   }, [source.id, selectedClips, effectiveMode, output]);
   const valid =
      request.items.length > 0 &&
      !!directory.trim() &&
      (effectiveMode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim())) &&
      collisions.size === 0 &&
      nameErrors.size === 0;
   // Main reports conflicts per clip, so the panel never replicates export naming rules.
   // While a recheck is pending the previous results stay shown: clearing them would replay
   // every row's warning animation on unrelated edits, and the recheck itself is debounced.
   useEffect(() => {
      let cancelled = false;
      if (!valid) {
         setConflicts(new Map());
         setDangers(new Map());
         return;
      }
      const timer = window.setTimeout(() => {
         void window.desktop
            .checkExportDestinations(request)
            .then((result) => {
               if (!cancelled) {
                  setConflicts(new Map(result.items.map((item) => [item.clipId ?? "combined", item.conflict])));
                  const nextDangers = new Map<string, boolean>();
                  for (const item of result.items) if (item.danger) nextDangers.set(item.clipId ?? "combined", true);
                  setDangers(nextDangers);
               }
            })
            .catch(() => {
               // Final planning shows destination errors when Export is pressed.
            });
      }, 250);
      return () => {
         cancelled = true;
         window.clearTimeout(timer);
      };
   }, [request, valid]);
   const start = async (approved?: ExportPlan) => {
      if (!valid || starting) return;
      setStarting(true);
      setError(null);
      let sourceReleased = false;
      try {
         const plan = approved ?? (await window.desktop.planExport(request));
         const unsupported = plan.items.find((item) => item.method === "unsupported");
         if (unsupported) throw new Error(unsupported.message);
         if (
            !approved &&
            (plan.directoryMissing || plan.existingPaths.length || plan.items.some(substantialEncoding) || plan.items.some((item) => item.changes?.length))
         ) {
            setConfirmation(plan);
            setReplaceSourceChecked(false);
            setStarting(false);
            return;
         }
         if (plan.sourcePath) {
            sourceReleased = true;
            await onBeforeSourceReplace();
         }
         const job = await window.desktop.startExport(
            plan.id,
            approved
               ? {
                    createDirectory: plan.directoryMissing,
                    overwrite: plan.existingPaths.length > 0,
                    replaceSource: !!plan.sourcePath,
                    substantialEncoding: plan.items.some(substantialEncoding),
                    mediaChanges: plan.items.some((item) => item.changes?.length),
                 }
               : undefined
         );
         setConfirmation(null);
         onStarted(job);
         onClose();
      } catch (value) {
         if (sourceReleased) onSourceReplaceStartFailed();
         setConfirmation(null);
         setError(errorText(value));
         setStarting(false);
      }
   };
   return {
      sourceAudio,
      otherStreams,
      directory,
      setDirectory,
      mode: effectiveMode,
      setMode,
      singleTarget,
      audioTracks,
      setAudioTracks,
      excludedStreams,
      setExcludedStreams,
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
      setName: setCombinedName,
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
   };
}

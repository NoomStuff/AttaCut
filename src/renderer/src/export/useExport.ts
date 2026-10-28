import { useEffect, useMemo, useState } from "react";
import { substantialEncoding } from "../../../shared/export-policy";
import { applyNamePattern, duplicateNames, filenameError } from "../../../shared/filename";
import { exportExtensionFor } from "../../../shared/export-format";
import type { Clip, ExportJob, ExportPlan, CutReport, MediaSource, Preferences } from "../../../shared/types";
import { errorText, isCancellation } from "../lib/errors";
import { rememberAudioSelection, resolveAudioSelection } from "../playback/audioSelection";

export interface ExportDraft {
   sourceId: string;
   directory: string;
   mode: Preferences["exportMode"];
   audioTracks: number[];
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
   const sourceAudio = source.streams.filter((stream) => stream.type === "audio");
   const [directory, setDirectory] = useState(saved?.directory ?? (preferences.outputDirectory || source.directory));
   const [mode, setMode] = useState<Preferences["exportMode"]>(clips.length === 1 ? "combined" : (saved?.mode ?? preferences.exportMode));
   const [audioTracks, updateAudioTracks] = useState(saved?.audioTracks ?? resolveAudioSelection(sourceAudio, preferences.exportAudio, true));
   const setAudioTracks = (selected: number[]) => {
      updateAudioTracks(selected);
      onPreferences((current) => ({ ...current, exportAudio: rememberAudioSelection(sourceAudio, selected, true) }));
   };
   const sourceStem = source.name.slice(0, -source.extension.length);
   // The patterns from settings are defaults: every output name follows its template until
   // it is edited by hand, and clearing a field hands the name back to the template. So a
   // template change in settings reaches every name that was never touched.
   const patternDefaults = { source: sourceStem, total: source.duration, date: new Date() };
   const generatedCombined = () =>
      applyNamePattern(preferences.combinedNamePattern, {
         ...patternDefaults,
         index: 0,
         count: 1,
         start: Math.min(...clips.map((clip) => clip.start)),
         end: Math.max(...clips.map((clip) => clip.end)),
      });
   const generatedName = (clip: Clip, index: number) =>
      applyNamePattern(preferences.clipNamePattern, { ...patternDefaults, index, count: clips.length, start: clip.start, end: clip.end });
   const [nameAltered, setNameAltered] = useState(saved?.nameAltered ?? false);
   const [name, setName] = useState(() => (saved?.nameAltered && saved?.name ? saved.name : generatedCombined()));
   const [rows, setRows] = useState(() =>
      clips.map((clip, index) => {
         const savedRow = saved?.rows.find((row) => row.clipId === clip.id);
         return {
            clip,
            included: savedRow?.included ?? true,
            altered: savedRow?.altered ?? false,
            name: savedRow?.altered && savedRow?.name ? savedRow.name : generatedName(clip, index),
         };
      })
   );
   const setCombinedName = (value: string) => {
      // An emptied field stays empty while typing (clearing to retype must not snap back);
      // leaving the field empty is what hands the name to the template, on blur.
      setNameAltered(value.trim() !== "");
      setName(value);
   };
   const setRowName = (index: number, value: string) => {
      setRows((current) => current.map((row, i) => (i === index ? { ...row, altered: value.trim() !== "", name: value } : row)));
   };
   useEffect(() => {
      onDraft({
         sourceId: source.id,
         directory,
         mode: clips.length === 1 ? preferences.exportMode : mode,
         audioTracks,
         name,
         nameAltered,
         rows: rows.map(({ clip, included, name, altered }) => ({ clipId: clip.id, included, name, altered })),
      });
   }, [source.id, directory, mode, clips.length, preferences.exportMode, audioTracks, name, nameAltered, rows, onDraft]);
   // A single clip requires combined mode but must not overwrite the multi-clip preference.
   useEffect(() => {
      if (clips.length > 1) onPreferences((current) => (current.exportMode === mode ? current : { ...current, exportMode: mode }));
   }, [clips.length, mode, onPreferences]);
   const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
   // Only an empty field hands the name back to its template on blur.
   // Invalid names stay visible until the user corrects them.
   const normalizeName = (index?: number) => {
      if (index === undefined) {
         if (name.trim() === "") {
            setNameAltered(false);
            setName(generatedCombined());
            return;
         }
         return;
      }
      setRows((current) =>
         current.map((row, i) => {
            if (i !== index) return row;
            if (row.name.trim() === "") return { ...row, altered: false, name: generatedName(row.clip, i) };
            return row;
         })
      );
   };
   const [replaceSourceChecked, setReplaceSourceChecked] = useState(false);
   const [conflicts, setConflicts] = useState<Map<string, string | null>>(() => new Map());
   const [dangers, setDangers] = useState<Map<string, boolean>>(() => new Map());
   // Batch-internal name collisions are computed live: two clips headed for one file would
   // overwrite each other, which no confirmation should ever have to referee.
   const collisions = useMemo(
      () => (mode === "separate" ? duplicateNames(rows.filter((row) => row.included).map((row) => row.name)) : new Set<string>()),
      [mode, rows]
   );
   const request = useMemo(
      () => ({
         sourceId: source.id,
         directory,
         mode,
         audioTracks,
         name,
         items: rows.filter((row) => row.included).map((row, index) => ({ clip: row.clip, name: mode === "combined" ? `Clip ${index + 1}` : row.name })),
      }),
      [source.id, directory, mode, audioTracks, name, rows]
   );
   const [error, setError] = useState<string | null>(null);
   const [starting, setStarting] = useState(false);
   const [analysis, setAnalysis] = useState<CutReport[] | null>(null);
   const selectedCount = request.items.length;
   const nameErrors = new Map<string, string>();
   if (mode === "combined") {
      const message = filenameError(name, source.exportExtension);
      if (message) nameErrors.set("combined", message);
   } else {
      for (const row of rows.filter((row) => row.included)) {
         const extension = exportExtensionFor(source, row.clip, { separate: true, allAudio: audioTracks.length === sourceAudio.length });
         const message = filenameError(row.name, extension);
         if (message) nameErrors.set(row.clip.id, message);
      }
   }
   const selectedClips = useMemo(() => rows.filter((row) => row.included).map((row) => row.clip), [rows]);
   // Media analysis is independent of filenames and destination checks, and reused at export.
   useEffect(() => {
      let cancelled = false;
      setAnalysis(null);
      if (!selectedClips.length) return;
      window.desktop
         .analyzeExport({ sourceId: source.id, mode, audioTracks, items: selectedClips.map((clip) => ({ clip, name: "clip" })) })
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
   }, [source.id, selectedClips, mode, audioTracks]);
   const valid =
      request.items.length > 0 &&
      !!directory.trim() &&
      (mode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim())) &&
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
      directory,
      setDirectory,
      mode,
      setMode,
      audioTracks,
      setAudioTracks,
      name,
      setName: setCombinedName,
      setRowName,
      normalizeName,
      rows,
      setRows,
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

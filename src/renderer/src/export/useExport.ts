import { useEffect, useMemo, useState } from "react";
import { substantialEncoding } from "../../../shared/export-policy";
import { sanitizeName } from "../../../shared/filename";
import type { Clip, ExportJob, ExportPlan, CutReport, MediaSource, Preferences } from "../../../shared/types";
import { errorText, isCancellation } from "../lib/errors";
import { rememberAudioSelection, resolveAudioSelection } from "../playback/audioSelection";

export interface ExportDraft {
   sourceId: string;
   directory: string;
   mode: Preferences["exportMode"];
   audioTracks: number[];
   name: string;
   rows: { clipId: string; included: boolean; name: string }[];
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
   const [name, setName] = useState(saved?.name ?? `${source.name.slice(0, -source.extension.length)} (Trim)`);
   const [rows, setRows] = useState(() =>
      clips.map((clip, index) => ({
         clip,
         included: saved?.rows.find((row) => row.clipId === clip.id)?.included ?? true,
         name: saved?.rows.find((row) => row.clipId === clip.id)?.name ?? `${source.name.slice(0, -source.extension.length)} (${index + 1})`,
      }))
   );
   useEffect(() => {
      onDraft({
         sourceId: source.id,
         directory,
         mode: clips.length === 1 ? preferences.exportMode : mode,
         audioTracks,
         name,
         rows: rows.map(({ clip, included, name }) => ({ clipId: clip.id, included, name })),
      });
   }, [source.id, directory, mode, clips.length, preferences.exportMode, audioTracks, name, rows, onDraft]);
   // A single clip requires combined mode but must not overwrite the multi-clip preference.
   useEffect(() => {
      if (clips.length > 1) onPreferences((current) => (current.exportMode === mode ? current : { ...current, exportMode: mode }));
   }, [clips.length, mode, onPreferences]);
   const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
   const normalizeName = (index?: number) => {
      if (index === undefined) {
         setName(sanitizeName(name));
         return;
      }
      setRows((current) => {
         const stem = sanitizeName(current[index]!.name);
         const others = new Set(current.filter((_, i) => i !== index).map((row) => sanitizeName(row.name).toLowerCase()));
         let result = stem;
         for (let suffix = 2; others.has(result.toLowerCase()); suffix++) result = `${stem} (${suffix})`;
         return current.map((row, i) => (i === index ? { ...row, name: result } : row));
      });
   };
   const [replaceSourceChecked, setReplaceSourceChecked] = useState(false);
   const [conflicts, setConflicts] = useState<Map<string, string | null>>(() => new Map());
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
   // Media analysis is independent of filenames and destination checks, and reused at export.
   useEffect(() => {
      let cancelled = false;
      setAnalysis(null);
      window.desktop
         .analyzeExport({ sourceId: source.id, mode, audioTracks, items: clips.map((clip) => ({ clip, name: "clip" })) })
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
   }, [source.id, clips, mode, audioTracks]);
   const valid = request.items.length > 0 && !!directory.trim() && (mode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim()));
   // Main reports conflicts per clip, so the panel never replicates export naming rules.
   // While a recheck is pending the previous results stay shown: clearing them would replay
   // every row's warning animation on unrelated edits, and the recheck itself is debounced.
   useEffect(() => {
      let cancelled = false;
      if (!valid) {
         setConflicts(new Map());
         return;
      }
      const timer = window.setTimeout(() => {
         void window.desktop
            .checkExportDestinations(request)
            .then((result) => {
               if (!cancelled) setConflicts(new Map(result.items.map((item) => [item.clipId ?? "combined", item.conflict])));
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
      setName,
      normalizeName,
      rows,
      setRows,
      confirmation,
      setConfirmation,
      replaceSourceChecked,
      setReplaceSourceChecked,
      conflicts,
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

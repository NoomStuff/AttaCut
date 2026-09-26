import { useEffect, useState } from "react";
import type { Clip, ExportJob, ExportPlan, CutReport, MediaSource, Preferences } from "../../../shared/types";
import { errorText } from "../lib/errors";
import { rememberAudioSelection, resolveAudioSelection } from "../playback/audioSelection";

export interface ExportDraft {
   sourceId: string;
   directory: string;
   mode: Preferences["exportMode"];
   audioTracks: number[];
   name: string;
   rows: { clip: Clip; included: boolean; name: string }[];
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
   const [audioTracks, setAudioTracks] = useState(saved?.audioTracks ?? resolveAudioSelection(sourceAudio, preferences.exportAudio, true));
   const [name, setName] = useState(saved?.name ?? `${source.name.slice(0, -source.extension.length)} (Trim)`);
   const [rows, setRows] = useState(() =>
      clips.map((clip, index) => ({
         clip,
         included: saved?.rows.find((row) => row.clip.id === clip.id)?.included ?? true,
         name: saved?.rows.find((row) => row.clip.id === clip.id)?.name ?? `${source.name.slice(0, -source.extension.length)} (${index + 1})`,
      }))
   );
   useEffect(() => {
      onDraft({ sourceId: source.id, directory, mode, audioTracks, name, rows });
   }, [source.id, directory, mode, audioTracks, name, rows, onDraft]);
   // Panel choices persist as export preferences; the updater form keeps this from
   // re-running (and from clobbering) when unrelated preferences change while the panel is open.
   useEffect(() => {
      const exportAudio = rememberAudioSelection(
         source.streams.filter((stream) => stream.type === "audio"),
         audioTracks
      );
      onPreferences((current) =>
         current.exportMode === mode && JSON.stringify(current.exportAudio) === JSON.stringify(exportAudio)
            ? current
            : { ...current, exportMode: mode, exportAudio }
      );
   }, [source, mode, audioTracks, onPreferences]);
   const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
   const [replaceSourceChecked, setReplaceSourceChecked] = useState(false);
   const [conflicts, setConflicts] = useState<Map<string, string | null>>(() => new Map());
   const request = {
      sourceId: source.id,
      directory,
      mode,
      audioTracks,
      name,
      items: rows.filter((row) => row.included).map((row, index) => ({ clip: row.clip, name: mode === "combined" ? `Clip ${index + 1}` : row.name })),
   };
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
         .catch(() => {
            // The note is informational; click-time planning still reports real problems.
         });
      return () => {
         cancelled = true;
         void window.desktop.cancelExportPlanning();
      };
   }, [source.id, clips, mode, audioTracks]);
   const valid = request.items.length > 0 && !!directory.trim() && (mode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim()));
   // Main reports conflicts per clip, so the panel never replicates export naming rules.
   const requestKey = JSON.stringify(request);
   useEffect(() => {
      let cancelled = false;
      setConflicts(new Map());
      if (!valid) return;
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
   }, [requestKey, valid]);
   const start = async (approved?: ExportPlan) => {
      if (!valid || starting) return;
      setStarting(true);
      setError(null);
      let sourceReleased = false;
      try {
         const plan = approved ?? (await window.desktop.planExport(request));
         const unsupported = plan.items.find((item) => item.method === "unsupported");
         if (unsupported) throw new Error(unsupported.message);
         if (!approved && (plan.directoryMissing || plan.existingPaths.length)) {
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
            approved ? { createDirectory: plan.directoryMissing, overwrite: plan.existingPaths.length > 0, replaceSource: !!plan.sourcePath } : undefined
         );
         setConfirmation(null);
         onPreferences((current) => ({ ...current, exportMode: mode, exportAudio: rememberAudioSelection(sourceAudio, audioTracks) }));
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

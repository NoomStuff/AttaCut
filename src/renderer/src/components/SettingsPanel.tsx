import { useEffect, useRef, useState } from "react";
import { navigateTabs } from "../lib/tabs";
import { faMoon, faSun, faDesktop, faCheck, faPlus, faXmark, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Clip, MediaSource, Preferences } from "../../../shared/types";
import { applyNamePattern, duplicateNames, hasNameToken, nameTokens } from "../../../shared/filename";
import type { NamePatternContext } from "../../../shared/filename";
import { commandDefinitions, bindingsFor, displayBinding, bindingFromEvent } from "../editor/commands";
import type { CommandId } from "../editor/commands";
import { Button, Modal, Toggle } from "./Controls";
import { DropdownSelect } from "./DropdownSelect";
const snapModifiers = [
   { value: "Alt", label: "Alt" },
   { value: "Shift", label: "Shift" },
   { value: "Control", label: "Ctrl" },
   { value: "none", label: "None" },
];
const shortcutGroups = [...new Set(Object.values(commandDefinitions).map(({ group }) => group))].map((group) => ({
   name: group,
   commands: (Object.keys(commandDefinitions) as CommandId[]).filter((id) => commandDefinitions[id].group === group),
}));

const clipNamePresets = [
   { value: "{source} ({n})", label: "Numbered" },
   { value: "{source} {start}-{end}", label: "Timestamped" },
];
const mergedNamePresets = [
   { value: "{source} (Trim)", label: "Default" },
   { value: "{source} {start}-{end}", label: "Timestamped" },
   { value: "{source} ({duration})", label: "Duration" },
];

// One naming pattern editor. The field edits the persisted pattern directly, the preset
// picker covers the common shapes, and the token chips are always visible so building a
// custom pattern never means hunting through a hidden panel. The example line uses the
// open recording's real clips when there are any, and a fixed stand-in recording only
// when there is nothing real to show. Patterns that would collide outputs, or name one
// exactly like the source video, say so right here.
function PatternEditor({
   label,
   ariaLabel,
   value,
   onChange,
   presets,
   kind,
   source,
   clips,
}: {
   label: string;
   ariaLabel: string;
   value: string;
   onChange: (value: string) => void;
   presets: { value: string; label: string }[];
   kind: "clips" | "merged";
   source: MediaSource | null;
   clips: Clip[];
}) {
   const input = useRef<HTMLInputElement>(null);
   // The field is uncontrolled on purpose: React never rewrites it while the user works,
   // so the browser's own undo stack covers typing, backspacing, and inserted tokens
   // alike, across focus changes. Outside changes (presets, reloads) land when idle.
   useEffect(() => {
      const element = input.current;
      if (element && document.activeElement !== element && element.value !== value) element.value = value;
   }, [value]);
   const insert = (token: string) => {
      const element = input.current;
      if (!element) {
         onChange(value + token);
         return;
      }
      element.focus();
      // Inserting through the editor command keeps the native undo stack, so Ctrl+Z
      // removes an inserted token like any other typing.
      const start = element.selectionStart ?? value.length;
      const end = element.selectionEnd ?? start;
      element.setSelectionRange(start, end);
      if (!document.execCommand("insertText", false, token)) {
         const next = value.slice(0, start) + token + value.slice(end);
         element.value = next;
         onChange(next);
         element.setSelectionRange(start + token.length, start + token.length);
      }
   };
   const date = new Date();
   const stem = source && hasNameToken(value) ? source.name.slice(0, -source.extension.length) : null;
   const contexts: NamePatternContext[] =
      kind === "clips"
         ? clips.length > 0
            ? [
                 {
                    source: stem ?? "recording",
                    index: 0,
                    count: clips.length,
                    start: clips[0]!.start,
                    end: clips[0]!.end,
                    total: source?.duration ?? 0,
                    date,
                 },
              ]
            : [0, 1, 2].map((index) => ({
                 source: "my-recording",
                 index,
                 count: 5,
                 start: 312.4 + index * 102.5,
                 end: 402.1 + index * 102.5,
                 total: 634.8,
                 date,
              }))
         : clips.length > 0
           ? [
                {
                   source: stem ?? "recording",
                   index: 0,
                   count: 1,
                   start: Math.min(...clips.map((clip) => clip.start)),
                   end: Math.max(...clips.map((clip) => clip.end)),
                   total: source?.duration ?? 0,
                   date,
                },
             ]
           : [{ source: "my-recording", index: 0, count: 1, start: 312.4, end: 498.8, total: 634.8, date }];
   const names = contexts.map((context) => applyNamePattern(value, context));
   // A scheme that hands several clips one name, or reuses the source's own name, would
   // collide at export; say so before the user ever opens the panel.
   const everyClipName =
      kind === "clips" && clips.length > 0
         ? clips.map((clip, index) =>
              applyNamePattern(value, {
                 source: stem ?? "recording",
                 index,
                 count: clips.length,
                 start: clip.start,
                 end: clip.end,
                 total: source?.duration ?? 0,
                 date,
              })
           )
         : [];
   const collision = duplicateNames(names).size > 0 || duplicateNames(everyClipName).size > 0;
   const overwritten = stem !== null && names.some((name) => name.toLowerCase() === stem.toLowerCase());
   const warning = collision
      ? "This pattern gives several clips the same file name."
      : overwritten
        ? "This pattern names an output exactly like the source video."
        : null;
   const preset = presets.find((entry) => entry.value === value);
   return (
      <div className="pattern-editor">
         <div className="pattern-head">
            <span>{label}</span>
            <DropdownSelect
               label={`${label} preset`}
               options={presets}
               value={[preset?.value ?? ""]}
               onChange={(values) => onChange(values[0] ?? value)}
               trigger={preset?.label ?? "Custom"}
            />
         </div>
         <span className="pattern-input">
            <input
               ref={input}
               aria-label={ariaLabel}
               defaultValue={value}
               aria-invalid={warning ? true : undefined}
               aria-describedby={warning ? `${ariaLabel}-warning` : undefined}
               onInput={(event) => onChange(event.currentTarget.value)}
            />
            {warning && (
               <span className="pattern-warning-icon" role="img" aria-label={warning} tabIndex={0}>
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span className="pattern-warning-tooltip" role="tooltip" id={`${ariaLabel}-warning`}>
                     {warning}
                  </span>
               </span>
            )}
         </span>
         <div className="pattern-tokens" role="group" aria-label={`Insert into ${ariaLabel}`}>
            {nameTokens.map((entry) => (
               <button key={entry.token} type="button" title={entry.description} onClick={() => insert(entry.token)}>
                  {entry.label}
               </button>
            ))}
         </div>
         <small className="pattern-preview">Example: {names.join(", ")}</small>
      </div>
   );
}

export function SettingsPanel({
   preferences,
   onChange,
   onClose,
   mac,
   initialTab,
   onTabChange,
   source,
   clips,
}: {
   preferences: Preferences;
   onChange: (value: Preferences) => void;
   onClose: () => void;
   mac: boolean;
   initialTab: "general" | "editing" | "shortcuts";
   onTabChange: (tab: "general" | "editing" | "shortcuts") => void;
   source: MediaSource | null;
   clips: Clip[];
}) {
   const [tab, setTab] = useState(initialTab);
   // Tab switches report up so "open settings" lands on the tab that was last open.
   const switchTab = (next: "general" | "editing" | "shortcuts") => {
      setTab(next);
      onTabChange(next);
   };
   const [query, setQuery] = useState("");
   const searchRef = useRef<HTMLInputElement>(null);
   const [recording, setRecording] = useState<{ id: CommandId; index: number | null } | null>(null);
   const [conflict, setConflict] = useState("");
   const [captured, setCaptured] = useState("");
   const [confirmReset, setConfirmReset] = useState(false);
   // Runs after the modal's dialog.focus(), so the search wins when the shortcuts tab opens.
   useEffect(() => {
      if (tab === "shortcuts") searchRef.current?.focus();
   }, [tab]);
   const editBinding = (id: CommandId, index: number | null) => {
      setRecording({ id, index });
      setCaptured("");
      setConflict("");
   };
   const updateBindings = (id: CommandId, bindings: string[]) => {
      onChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [id]: bindings } });
      setRecording(null);
      setConflict("");
   };
   const needle = query.trim().toLowerCase();
   const showHoldToSnap = ["Hold to snap", ...snapModifiers.map(({ label }) => label)].join(" ").toLowerCase().includes(needle);
   const matches = (id: CommandId) => {
      if (!needle) return true;
      // A row being edited stays visible even when the query no longer matches it.
      if (recording?.id === id) return true;
      const bindings = bindingsFor(id, preferences.shortcuts);
      return [commandDefinitions[id].label, ...bindings, ...bindings.map((binding) => displayBinding(binding, mac))].join(" ").toLowerCase().includes(needle);
   };
   const captureBinding = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!recording || event.nativeEvent.isComposing || event.repeat) return;
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
         setRecording(null);
         return;
      }
      if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
      const binding = bindingFromEvent(event.nativeEvent, mac);
      setCaptured(binding);
      if (["ALT+F4", "MOD+Q", "MOD+W", "MOD+C", "MOD+V", "MOD+X", "ENTER"].includes(binding.toUpperCase())) {
         setConflict("That shortcut belongs to the system or a standard control.");
         return;
      }
      const duplicate = (Object.keys(commandDefinitions) as CommandId[]).find((id) =>
         bindingsFor(id, preferences.shortcuts).some(
            (key, index) => !(id === recording.id && index === recording.index) && key.toUpperCase() === binding.toUpperCase()
         )
      );
      setConflict(duplicate ? `Already used by ${commandDefinitions[duplicate].label.toLowerCase()}.` : "");
   };
   return (
      <>
         <Modal title="Settings" onClose={onClose} className="panel-modal settings-modal">
            <div className="modal-tabs" role="tablist" onKeyDown={navigateTabs}>
               <button
                  role="tab"
                  aria-selected={tab === "general"}
                  tabIndex={tab === "general" ? 0 : -1}
                  onClick={() => {
                     switchTab("general");
                     setRecording(null);
                  }}
               >
                  General
               </button>
               <button
                  role="tab"
                  aria-selected={tab === "editing"}
                  tabIndex={tab === "editing" ? 0 : -1}
                  onClick={() => {
                     switchTab("editing");
                     setRecording(null);
                  }}
               >
                  Editing
               </button>
               <button role="tab" aria-selected={tab === "shortcuts"} tabIndex={tab === "shortcuts" ? 0 : -1} onClick={() => switchTab("shortcuts")}>
                  Keyboard shortcuts
               </button>
            </div>
            <div className="modal-body" key={tab}>
               {tab === "general" ? (
                  <>
                     <section className="settings-group" aria-labelledby="settings-appearance">
                        <h3 id="settings-appearance">Appearance</h3>
                        <div className="setting-row">
                           <div>
                              Theme<small>System follows your device's appearance.</small>
                           </div>
                           <div className="theme-picker" role="group" aria-label="Appearance">
                              {(["dark", "system", "light"] as const).map((theme) => (
                                 <button
                                    key={theme}
                                    aria-label={`${theme[0]!.toUpperCase()}${theme.slice(1)} theme`}
                                    aria-pressed={preferences.theme === theme}
                                    onClick={() => onChange({ ...preferences, theme })}
                                 >
                                    <FontAwesomeIcon icon={theme === "dark" ? faMoon : theme === "system" ? faDesktop : faSun} />
                                    <span>
                                       {theme[0]!.toUpperCase()}
                                       {theme.slice(1)}
                                    </span>
                                 </button>
                              ))}
                           </div>
                        </div>
                        <div className="setting-row">
                           <div>
                              Accent colour<small>Used for buttons, active controls, and focus.</small>
                           </div>
                           <div className="accent-picker" role="group" aria-label="Accent colour">
                              {["Blue", "Purple", "Green", "Yellow", "Red"].map((name, accent) => (
                                 <button
                                    key={name}
                                    aria-label={`${name} accent`}
                                    title={name}
                                    aria-pressed={preferences.accent === accent}
                                    style={{ background: `var(--clip-${accent})` }}
                                    onClick={() => onChange({ ...preferences, accent })}
                                 >
                                    {preferences.accent === accent && <FontAwesomeIcon icon={faCheck} />}
                                 </button>
                              ))}
                           </div>
                        </div>
                     </section>
                     <section className="settings-group" aria-labelledby="settings-startup">
                        <h3 id="settings-startup">Startup</h3>
                        <Toggle
                           label="Pick up where you left off"
                           description="Reopen your latest video and timeline when AttaCut starts."
                           checked={preferences.resume}
                           onChange={(resume) => onChange({ ...preferences, resume })}
                        />
                        <Toggle
                           label="Check for updates"
                           description="Look for new AttaCut releases while the app starts. You can check anytime from the Help menu."
                           checked={preferences.updateCheck}
                           onChange={(updateCheck) => onChange({ ...preferences, updateCheck })}
                        />
                     </section>
                  </>
               ) : tab === "editing" ? (
                  <>
                     <section className="settings-group" aria-labelledby="settings-playback">
                        <h3 id="settings-playback">Playback</h3>
                        <Toggle
                           label="Play kept clips only"
                           description="Skip deleted ranges when playing them in the editor."
                           checked={preferences.keptOnly}
                           onChange={(keptOnly) => onChange({ ...preferences, keptOnly })}
                        />
                        <Toggle
                           label="Keep playing while editing"
                           description="Don't stop playing after seeking, trimming or splitting."
                           checked={preferences.keepPlaying}
                           onChange={(keepPlaying) => onChange({ ...preferences, keepPlaying })}
                        />
                        <Toggle
                           label="Audio scrubbing"
                           description="Play a short audio burst at the playhead while scrubbing and stepping with playback paused."
                           checked={preferences.audioScrub}
                           onChange={(audioScrub) => onChange({ ...preferences, audioScrub })}
                        />
                     </section>
                     <section className="settings-group" aria-labelledby="settings-export">
                        <h3 id="settings-export">Export</h3>
                        <PatternEditor
                           label="Clip names"
                           ariaLabel="Clip name pattern"
                           value={preferences.clipNamePattern}
                           onChange={(value) => onChange({ ...preferences, clipNamePattern: value })}
                           presets={clipNamePresets}
                           kind="clips"
                           source={source}
                           clips={clips}
                        />
                        <PatternEditor
                           label="Merged video name"
                           ariaLabel="Merged video name pattern"
                           value={preferences.combinedNamePattern}
                           onChange={(value) => onChange({ ...preferences, combinedNamePattern: value })}
                           presets={mergedNamePresets}
                           kind="merged"
                           source={source}
                           clips={clips}
                        />
                     </section>
                  </>
               ) : (
                  <>
                     <div className="shortcut-toolbar">
                        <input
                           ref={searchRef}
                           className="shortcut-search"
                           type="search"
                           placeholder="Search actions or keys"
                           aria-label="Search shortcuts"
                           value={query}
                           onChange={(event) => setQuery(event.target.value)}
                        />
                        <Button variant="danger" onClick={() => setConfirmReset(true)}>
                           Reset bindings
                        </Button>
                     </div>
                     <div className="shortcut-list">
                        {shortcutGroups.map((group) => {
                           const commands = group.commands.filter(matches);
                           const showModifier = group.name === "Clips" && showHoldToSnap;
                           if (!commands.length && !showModifier) return null;
                           return (
                              <section className="shortcut-group" key={group.name} aria-labelledby={`shortcuts-${group.name}`}>
                                 <h3 id={`shortcuts-${group.name}`}>{group.name}</h3>
                                 {showModifier && (
                                    <div className="shortcut-row">
                                       <div className="shortcut-line">
                                          <span className="shortcut-action">Hold to snap</span>
                                          <DropdownSelect
                                             label="Hold to snap"
                                             options={snapModifiers}
                                             required
                                             value={[preferences.holdToSnap]}
                                             onChange={([holdToSnap]) => onChange({ ...preferences, holdToSnap: holdToSnap as Preferences["holdToSnap"] })}
                                             trigger={<kbd>{snapModifiers.find(({ value }) => value === preferences.holdToSnap)!.label}</kbd>}
                                          />
                                       </div>
                                    </div>
                                 )}
                                 {commands.map((id) => (
                                    <div className="shortcut-row" key={id}>
                                       <div className="shortcut-line">
                                          <span className="shortcut-action">{commandDefinitions[id].label}</span>
                                          <div className="shortcut-bindings">
                                             {bindingsFor(id, preferences.shortcuts).map((binding, index) => (
                                                <span className="shortcut-chip" key={binding}>
                                                   <button
                                                      className="shortcut-binding"
                                                      data-press-ignore
                                                      aria-label={`Change ${displayBinding(binding, mac)} for ${commandDefinitions[id].label}`}
                                                      onClick={() => editBinding(id, index)}
                                                   >
                                                      <kbd>{displayBinding(binding, mac)}</kbd>
                                                   </button>
                                                   <button
                                                      className="shortcut-remove"
                                                      aria-label={`Remove ${displayBinding(binding, mac)} from ${commandDefinitions[id].label}`}
                                                      onClick={() =>
                                                         updateBindings(
                                                            id,
                                                            bindingsFor(id, preferences.shortcuts).filter((_, i) => i !== index)
                                                         )
                                                      }
                                                   >
                                                      <FontAwesomeIcon icon={faXmark} />
                                                   </button>
                                                </span>
                                             ))}
                                             <button
                                                className="shortcut-add"
                                                aria-label={`Add binding for ${commandDefinitions[id].label}`}
                                                onClick={() => editBinding(id, null)}
                                             >
                                                <FontAwesomeIcon icon={faPlus} />
                                             </button>
                                          </div>
                                       </div>
                                       {recording?.id === id && (
                                          <div className="shortcut-editor" key={`${id}-${recording.index}`}>
                                             <button
                                                className="shortcut-capture"
                                                data-press-ignore
                                                ref={(element) => {
                                                   element?.focus();
                                                }}
                                                aria-label={`Record binding for ${commandDefinitions[id].label}`}
                                                aria-describedby={`binding-help-${id}`}
                                                onKeyDown={captureBinding}
                                             >
                                                <kbd>{captured ? displayBinding(captured, mac) : "Press keys…"}</kbd>
                                             </button>
                                             <div className="shortcut-editor-actions">
                                                <p
                                                   id={`binding-help-${id}`}
                                                   className={conflict ? "inline-error" : "shortcut-hint"}
                                                   role={conflict ? "alert" : undefined}
                                                >
                                                   {conflict || "Press a key combination, then save. Escape cancels."}
                                                </p>
                                                <Button onClick={() => setRecording(null)}>Cancel</Button>
                                                <Button
                                                   variant="primary"
                                                   disabled={!captured || !!conflict}
                                                   onClick={() => {
                                                      const bindings = [...bindingsFor(id, preferences.shortcuts)];
                                                      if (recording.index === null) bindings.push(captured);
                                                      else bindings[recording.index] = captured;
                                                      updateBindings(id, bindings);
                                                   }}
                                                >
                                                   Save binding
                                                </Button>
                                             </div>
                                          </div>
                                       )}
                                    </div>
                                 ))}
                              </section>
                           );
                        })}
                        {!showHoldToSnap && !shortcutGroups.some((group) => group.commands.some(matches)) && (
                           <p className="shortcut-empty">No actions match that search.</p>
                        )}
                     </div>
                  </>
               )}
            </div>
         </Modal>
         {confirmReset && (
            <Modal title="Reset keyboard shortcuts?" onClose={() => setConfirmReset(false)} className="settings-reset-confirm">
               <div className="modal-body">This removes your custom bindings and restores the default shortcuts.</div>
               <div className="modal-footer">
                  <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
                  <Button
                     variant="danger"
                     onClick={() => {
                        onChange({ ...preferences, shortcuts: {}, holdToSnap: "Alt" });
                        setRecording(null);
                        setConflict("");
                        setQuery("");
                        setConfirmReset(false);
                     }}
                  >
                     Reset bindings
                  </Button>
               </div>
            </Modal>
         )}
      </>
   );
}

import { useEffect, useRef, useState } from "react";
import { faMoon, faSun, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Preferences } from "../../../shared/types";
import { commandDefinitions, bindingsFor, displayBinding, bindingFromEvent } from "../editor/commands";
import type { CommandId } from "../editor/commands";
import { Button, Modal, Toggle } from "./Controls";
const shortcutGroups = [...new Set(Object.values(commandDefinitions).map(({ group }) => group))].map((group) => ({
   name: group,
   commands: (Object.keys(commandDefinitions) as CommandId[]).filter((id) => commandDefinitions[id].group === group),
}));

export function SettingsPanel({
   preferences,
   onChange,
   onClose,
   mac,
   initialTab,
}: {
   preferences: Preferences;
   onChange: (value: Preferences) => void;
   onClose: () => void;
   mac: boolean;
   initialTab: "general" | "shortcuts";
}) {
   const [tab, setTab] = useState(initialTab);
   const [query, setQuery] = useState("");
   const searchRef = useRef<HTMLInputElement>(null);
   const [recording, setRecording] = useState<{ id: CommandId; index: number | null } | null>(null);
   const [conflict, setConflict] = useState("");
   const [captured, setCaptured] = useState("");
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
      <Modal title="Settings" onClose={onClose}>
         <div className="settings-tabs" role="tablist">
            <button
               role="tab"
               aria-selected={tab === "general"}
               onClick={() => {
                  setTab("general");
                  setRecording(null);
               }}
            >
               General
            </button>
            <button role="tab" aria-selected={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
               Keyboard shortcuts
            </button>
         </div>
         <div className="modal-body">
            {tab === "general" ? (
               <>
                  <div className="setting-row">
                     <div>
                        Appearance<small>Your preferred app theme.</small>
                     </div>
                     <div className="theme-picker" role="group" aria-label="Appearance">
                        {(["dark", "light"] as const).map((theme) => (
                           <button
                              key={theme}
                              aria-label={theme === "dark" ? "Dark theme" : "Light theme"}
                              title={theme === "dark" ? "Dark theme" : "Light theme"}
                              aria-pressed={preferences.theme === theme}
                              onClick={() => onChange({ ...preferences, theme })}
                           >
                              <FontAwesomeIcon icon={theme === "dark" ? faMoon : faSun} />
                           </button>
                        ))}
                     </div>
                  </div>
                  <Toggle
                     label="Play kept clips only"
                     description="Skip deleted ranges when playing them in the editor."
                     checked={preferences.keptOnly}
                     onChange={(keptOnly) => onChange({ ...preferences, keptOnly })}
                  />
                  <Toggle
                     label="Keep playing while editing"
                     description="Keep playback running when seeking, trimming, or splitting."
                     checked={preferences.keepPlaying}
                     onChange={(keepPlaying) => onChange({ ...preferences, keepPlaying })}
                  />
                  <Toggle
                     label="Audio scrubbing"
                     description="Play a short audio burst at the playhead while scrubbing and stepping with playback paused. Unavailable for sources over two hours."
                     checked={preferences.audioScrub}
                     onChange={(audioScrub) => onChange({ ...preferences, audioScrub })}
                  />
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
                     <Button
                        variant="danger"
                        onClick={() => {
                           onChange({ ...preferences, shortcuts: {} });
                           setRecording(null);
                           setConflict("");
                        }}
                     >
                        Reset bindings
                     </Button>
                  </div>
                  <div className="shortcut-list">
                     {shortcutGroups.map((group) => {
                        const commands = group.commands.filter(matches);
                        if (!commands.length) return null;
                        return (
                           <section className="shortcut-group" key={group.name} aria-labelledby={`shortcuts-${group.name}`}>
                              <h3 id={`shortcuts-${group.name}`}>{group.name}</h3>
                              {commands.map((id) => (
                                 <div className="shortcut-row" key={id}>
                                    <div className="shortcut-line">
                                       <span className="shortcut-action">{commandDefinitions[id].label}</span>
                                       <div className="shortcut-bindings">
                                          {bindingsFor(id, preferences.shortcuts).map((binding, index) => (
                                             <span className="shortcut-chip" key={binding}>
                                                <button
                                                   className="shortcut-binding"
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
                     {!shortcutGroups.some((group) => group.commands.some(matches)) && <p className="shortcut-empty">No actions match that search.</p>}
                  </div>
               </>
            )}
         </div>
      </Modal>
   );
}

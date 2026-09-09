import { useState } from "react";
import type { Preferences } from "../../../shared/types";
import { commandDefinitions, bindingFor, displayBinding, bindingFromEvent } from "../editor/commands";
import type { CommandId } from "../editor/commands";
import { Button, Modal, Toggle } from "./Controls";
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
   const [recording, setRecording] = useState<CommandId | null>(null);
   const [conflict, setConflict] = useState("");
   return (
      <Modal title="Settings" onClose={onClose}>
         <div className="settings-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "general"} onClick={() => setTab("general")}>
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
                        Appearance<small>A quiet frame around your video.</small>
                     </div>
                     <select
                        aria-label="Appearance"
                        value={preferences.theme}
                        onChange={(event) => onChange({ ...preferences, theme: event.target.value === "light" ? "light" : "dark" })}
                     >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                     </select>
                  </div>
                  <Toggle
                     label="Play kept clips only"
                     description="Skip excluded ranges during playback. Export is unchanged."
                     checked={preferences.keptOnly}
                     onChange={(keptOnly) => onChange({ ...preferences, keptOnly })}
                  />
                  <Toggle
                     label="Keep playing while editing"
                     description="Keep playback running when seeking, trimming, or splitting."
                     checked={preferences.keepPlaying}
                     onChange={(keepPlaying) => onChange({ ...preferences, keepPlaying })}
                  />
               </>
            ) : (
               <>
                  {conflict && (
                     <p className="inline-error" role="alert">
                        {conflict}
                     </p>
                  )}
                  <Button
                     onClick={() => {
                        onChange({ ...preferences, shortcuts: {} });
                        setRecording(null);
                        setConflict("");
                     }}
                  >
                     Restore default shortcuts
                  </Button>
                  <div className="shortcut-list">
                     {(Object.keys(commandDefinitions) as CommandId[]).map((id) => (
                        <div className="shortcut-row" key={id}>
                           <span>{commandDefinitions[id].label}</span>
                           <button
                              className={`shortcut-binding ${recording === id ? "recording" : ""}`}
                              aria-label={`Change shortcut for ${commandDefinitions[id].label}`}
                              onClick={() => {
                                 setRecording(id);
                                 setConflict("");
                              }}
                              onKeyDown={(event) => {
                                 if (recording !== id) return;
                                 event.preventDefault();
                                 event.stopPropagation();
                                 if (event.key === "Escape") {
                                    setRecording(null);
                                    return;
                                 }
                                 if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
                                 const binding = bindingFromEvent(event.nativeEvent, mac);
                                 if (["ALT+F4", "MOD+Q", "MOD+W", "MOD+C", "MOD+V", "MOD+X", "TAB", "SHIFT+TAB", "ENTER"].includes(binding.toUpperCase())) {
                                    setConflict("That shortcut belongs to the system or a standard control.");
                                    return;
                                 }
                                 const duplicate = (Object.keys(commandDefinitions) as CommandId[]).find(
                                    (other) => other !== id && bindingFor(other, preferences.shortcuts).toUpperCase() === binding.toUpperCase()
                                 );
                                 if (duplicate) {
                                    setConflict(`Already used by ${commandDefinitions[duplicate].label.toLowerCase()}.`);
                                    return;
                                 }
                                 onChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [id]: binding } });
                                 setRecording(null);
                                 setConflict("");
                              }}
                           >
                              <kbd>{recording === id ? "Press keys…" : displayBinding(bindingFor(id, preferences.shortcuts), mac) || "Unassigned"}</kbd>
                           </button>
                        </div>
                     ))}
                  </div>
               </>
            )}
         </div>
      </Modal>
   );
}

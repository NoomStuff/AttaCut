import { useContext, useRef, useState } from "react";
import { navigateTabs } from "../lib/tabs";
import type { ReactNode } from "react";
import { Modal } from "./Controls";
import { CommandContext, bindingsFor, displayBindings } from "../editor/commands";
import type { CommandId } from "../editor/commands";

export type HelpTab = "intro" | "start" | "clips" | "lossless" | "export";

function Shortcut({ command }: { command: CommandId }) {
   const context = useContext(CommandContext);
   const binding = context && displayBindings(bindingsFor(command, context.overrides), context.mac);
   return binding ? <kbd>{binding}</kbd> : null;
}

function HoldSnapHint() {
   const modifier = useContext(CommandContext)?.holdToSnap ?? "Alt";
   return (
      <>
         {modifier !== "none" && (
            <>
               <kbd>{modifier === "Control" ? "Ctrl" : modifier}</kbd>
            </>
         )}
         {modifier === "none" && <>the Hold Snap modifier in Settings</>}
      </>
   );
}

const topics: { id: HelpTab; label: string; body: ReactNode }[] = [
   {
      id: "intro",
      label: "Introduction",
      body: (
         <>
            <p>Welcome to the AttaCut!</p>
            <h3>What is this thing?</h3>
            <p>It's a simple app designed for cutting clips out of a video as fast as possible. Open the file, grab the part you want, save it, done.</p>
            <p>
               You mark ranges to keep them. Most of the video can be copied straight over into your new file, so exports are fast and the result looks like
               what you previewed.
            </p>
            <p>Feel free to read other tabs if you want to learn more or are stuck.</p>
         </>
      ),
   },
   {
      id: "start",
      label: "Getting started",
      body: (
         <>
            <p>You generally work like this.</p>
            <ol>
               <li>Open a recording: Drag and drop the file onto the window, or use Import.</li>
               <li>
                  The whole video starts as one clip. Pull the timeline handles inward to cut the ends off. For a section in the middle, split the clip at both
                  sides and delete the part between.
               </li>
               <li>Press Export, pick a folder, and save the clips as separate files or a single video.</li>
            </ol>
            <h3>Good to know</h3>
            <ul>
               <li>Your latest recording and its cuts are remembered, so restarting AttaCut restores your edit.</li>
               <li>
                  Play normally runs through the whole recording. The "Play kept clips only" setting skips the gaps, so playback shows only what will be
                  exported. You can also use <Shortcut command="preview" /> to preview only the current clip.
               </li>
               <li>
                  Most actions have a keyboard shortcut and you can rebind all of them. Press <Shortcut command="shortcuts" /> to open the list.
               </li>
            </ul>
         </>
      ),
   },
   {
      id: "clips",
      label: "Clips and gaps",
      body: (
         <>
            <p>A clip is a range that will be in the export. A gap is the space between clips, and everything inside a gap is left out of the export.</p>
            <p>A new video starts as one clip covering the whole recording. By trimming, splitting, and deleting, you can choose what to keep.</p>
            <h3>Your toolbox</h3>
            <ul>
               <li>
                  <strong>Trim:</strong> Drag a clip handle on the timeline, type a Start or End time, or press <Shortcut command="setStart" /> /{" "}
                  <Shortcut command="setEnd" /> to trim left or right from the playhead.
               </li>
               <li>
                  <strong>Split:</strong> <Shortcut command="split" /> cuts a clip in two at the playhead, so a middle section can be removed.
               </li>
               <li>
                  <strong>Delete:</strong> Removes the selected clip, its range becomes a gap.
               </li>
               <li>
                  <strong>Add:</strong> Turns a whole gap at the playhead back into a clip.
               </li>
               <li>
                  <strong>Merge:</strong> <Shortcut command="merge" /> joins two adjacent clips back together. Put the playhead on their shared cut first.
               </li>
               <li>
                  <strong>Toggle:</strong> <Shortcut command="toggleClip" /> removes a clip, or adds one if the playhead is in a gap.
               </li>
            </ul>
         </>
      ),
   },
   {
      id: "lossless",
      label: "Cutting losslessly",
      body: (
         <>
            <p>
               Videos don't store every frame in full. A <strong>keyframe</strong> holds a complete picture, and most other frames only record what changed
               since the last one.
            </p>
            <h3>Why this matters</h3>
            <p>
               When copying the data from the original file, we can only cleanly start at a keyframe. Meaning some of those frames near the edges of a cut may
               have to be encoded again, losing a little bit of quality, though most of the clip can be copied losslessly.
            </p>
            <h3>If you want lossless cuts</h3>
            <p>
               To avoid encoding frames again near the edges of your cuts, turn on <strong>Keyframe Snapping</strong> with the magnet icon, by pressing
               <Shortcut command="snap" />, or holding <HoldSnapHint />.
            </p>
            <p>
               This shows keyframe positions, and handles and splits will then be snapped to them. That gives you fewer places to cut, but can preserve the
               original quality if that is what you're looking for.
            </p>
            <p>You will get a heads up when exporting showing how much time needs to be re-encoded to do that export so you know what you lose.</p>
         </>
      ),
   },
   {
      id: "export",
      label: "Export",
      body: (
         <>
            <h3>Saving your clips</h3>
            <p>
               Choose the clips you want to save, their filenames, and an output folder. Separate Clips saves each selected clip as its own file. Single Video
               joins them into one file in their original order, leaving out the gaps.
            </p>
            <p>Choose which audio tracks to keep in the export dialog.</p>
            <h3>When encoding needs your approval</h3>
            <p>Small sections near a cut may need encoding again for an accurate cut.</p>
            <p>
               If a cut needs a large section encoded again, export asks you to confirm the quality change. If a format can't keep your chosen cut or some of
               the original video's content, the export dialog explains why and what you can do.
            </p>
            <h3>Replacing files</h3>
            <p>
               If a filename already exists in the output folder, AttaCut asks before replacing it. Saving over the video you opened also requires you to check
               that you understand it replaces the original. This cannot be undone. The exported video opens when it's ready.
            </p>
         </>
      ),
   },
];

export function HelpPanel({ initialTab = "intro", onClose }: { initialTab?: HelpTab; onClose: () => void }) {
   const [tab, setTab] = useState<HelpTab>(initialTab);
   const body = useRef<HTMLDivElement>(null);
   return (
      <Modal title="Help" onClose={onClose} className="panel-modal help-modal">
         <div className="modal-tabs" role="tablist" onKeyDown={navigateTabs}>
            {topics.map((topic) => (
               <button
                  key={topic.id}
                  role="tab"
                  aria-selected={tab === topic.id}
                  tabIndex={tab === topic.id ? 0 : -1}
                  onClick={() => {
                     setTab(topic.id);
                     body.current?.scrollTo(0, 0);
                  }}
               >
                  {topic.label}
               </button>
            ))}
         </div>
         <div className="modal-body help-body" key={tab} ref={body}>
            {topics.find((topic) => topic.id === tab)!.body}
         </div>
      </Modal>
   );
}

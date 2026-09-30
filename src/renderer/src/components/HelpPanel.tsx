import { useRef, useState } from "react";
import { navigateTabs } from "../lib/tabs";
import type { ReactNode } from "react";
import { Modal } from "./Controls";

export type HelpTab = "intro" | "start" | "clips" | "lossless";

const topics: { id: HelpTab; label: string; body: ReactNode }[] = [
   {
      id: "intro",
      label: "Introduction",
      body: (
         <>
            <h3>Welcome to AttaCut!</h3>
            <p>
               This app is designed for cutting clips out of a video as fast as possible. Open the file, grab the part you want, save it, done. Most editors put
               a project, a timeline, and a full re-render between you and that end result.
            </p>
            <p>
               You mark ranges to keep them. Most of the video can be copied straight over into your new file, so exports are fast and the result looks like
               what you previewed.
            </p>
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
               <li>Open a recording. Drag the file onto the window, or use Import.</li>
               <li>
                  The whole video starts as one clip. Pull the timeline handles inward to cut the ends off. For a section in the middle, split the clip at both
                  sides and delete the part between.
               </li>
               <li>Press Export, pick a folder, and save the clips as separate files or one merged video.</li>
            </ol>
            <h3>Worth knowing</h3>
            <ul>
               <li>Editing leaves the original unchanged. Undo and redo revert edits. Replacing the original during export requires your confirmation.</li>
               <li>Your latest recording and its cuts are remembered, so restarting AttaCut restores your edit.</li>
               <li>
                  Play normally runs through the whole recording. The "Play kept clips only" setting skips the gaps, so playback shows only what will be
                  exported. You can also use <kbd>P</kbd> to preview only the current clip.
               </li>
               <li>
                  Most actions have a keyboard shortcut and you can rebind all of them. Press <kbd>/</kbd> to open the list.
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
            <p>A clip is a range that will be in the export. A gap is the space between clips, and everything inside a gap is thrown away.</p>
            <p>A new video starts as one clip covering the whole recording. By trimming, splitting, and deleting, you can choose what to keep.</p>
            <h3>The tools</h3>
            <ul>
               <li>
                  <strong>Trim</strong> Drag a clip handle on the timeline, or press <kbd>A</kbd> / <kbd>D</kbd> to trim left or right from the playhead.
               </li>
               <li>
                  <strong>Split</strong> (<kbd>S</kbd>). Cuts a clip in two at the playhead, so a middle section can be removed.
               </li>
               <li>
                  <strong>Delete</strong> Removes the selected clip, its range becomes a gap.
               </li>
               <li>
                  <strong>Add</strong> Turns a whole gap at the playhead back into a clip.
               </li>
               <li>
                  <strong>Toggle</strong> (<kbd>W</kbd>). Remove a clip, or add one if the playhead is in a gap.
               </li>
               <li>
                  <strong>Merge</strong> (<kbd>E</kbd>). Joins two adjacent clips back together, put the playhead on their seam first.
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
               since the last one. That's what makes video files small, and it's also why a player can only start decoding cleanly from a keyframe.
            </p>
            <h3>Why this matters</h3>
            <p>
               When copying the data from the original file, we can only cleanly start at a keyframe. Meaning that some frames at the edges of a cut may have to
               be re-encoded, losing a little bit of quality, while the rest of the clip can losslessly be copied.
            </p>
            <h3>When encoding needs your approval</h3>
            <p>
               If a cut needs a large section re-encoded, export asks you to confirm the quality change. Formats whose edges can't be reproduced faithfully
               still need a different cut. The export dialog explains the cause. Keyframe Snapping can avoid boundary encoding, but some formats have other
               preservation limits.
            </p>
            <h3>If you want lossless cuts</h3>
            <p>
               To export a clip with no re-encoding at all, turn on <strong>Keyframe Snapping</strong> with the magnet icon or <kbd>C</kbd>. This shows keyframe
               positions, and handles and splits will then be snapped to them. That trades being able to make frame-exact cuts for losing 0 quality when
               exporting.
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

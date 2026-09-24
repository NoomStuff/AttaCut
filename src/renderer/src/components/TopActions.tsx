import { useSyncExternalStore } from "react";
import { faLink, faPlus, faTrash, faScissors, faRotateLeft, faRotateRight, faCamera, faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons";
import type { PlaybackClock } from "../playback/clock";
import type { CommandId, Commands } from "../editor/commands";
import { Button, IconButton } from "./Controls";

const shown: CommandId[] = ["add", "delete", "merge", "split", "undo", "redo", "frame", "export"];

export function TopActions({ commands, clock }: { commands: Commands; clock: PlaybackClock }) {
   // These buttons only change with command availability, so subscribe to that signature
   // instead of every clock tick during playback.
   useSyncExternalStore(clock.subscribe, () => shown.map((id) => (commands[id].enabled() ? 1 : 0)).join(""));
   return (
      <div className="top-actions">
         <IconButton command="add" icon={faPlus} label="Add clip in gap" />
         <IconButton command="delete" icon={faTrash} label="Delete selected clip" />
         <IconButton command="merge" icon={faLink} label="Merge clips" />
         <Button icon={faScissors} command="split">
            Split
         </Button>
         <span className="control-divider" />
         <IconButton icon={faRotateLeft} label="Undo" command="undo" />
         <IconButton icon={faRotateRight} label="Redo" command="redo" />
         <span className="control-divider" />
         <IconButton command="frame" icon={faCamera} label="Export current frame" />
         <Button variant="primary" icon={faArrowUpFromBracket} command="export" shortcut="">
            Export
         </Button>
      </div>
   );
}

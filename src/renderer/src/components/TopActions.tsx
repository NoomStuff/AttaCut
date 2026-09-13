import { faLink, faPlus, faTrash, faScissors, faRotateLeft, faRotateRight, faCamera, faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import type { Commands } from "../editor/commands";
import { Button, IconButton } from "./Controls";

export function TopActions({ commands, clock }: { commands: Commands; clock: PlaybackClock }) {
   useClock(clock);
   return (
      <div className="top-actions">
         <IconButton command="add" icon={faPlus} label="Add clip in gap" disabled={!commands.add.enabled()} onClick={commands.add.run} />
         <IconButton command="delete" icon={faTrash} label="Delete selected clip" disabled={!commands.delete.enabled()} onClick={commands.delete.run} />
         <IconButton command="merge" icon={faLink} label="Merge clips" />
         <Button icon={faScissors} command="split" disabled={!commands.split.enabled()} onClick={commands.split.run}>
            Split
         </Button>
         <span className="control-divider" />
         <IconButton icon={faRotateLeft} label="Undo" command="undo" disabled={!commands.undo.enabled()} onClick={commands.undo.run} />
         <IconButton icon={faRotateRight} label="Redo" command="redo" disabled={!commands.redo.enabled()} onClick={commands.redo.run} />
         <span className="control-divider" />
         <IconButton command="frame" icon={faCamera} label="Export current frame" disabled={!commands.frame.enabled()} onClick={commands.frame.run} />
         <Button variant="primary" icon={faArrowUpFromBracket} command="export" shortcut="" disabled={!commands.export.enabled()} onClick={commands.export.run}>
            Export
         </Button>
      </div>
   );
}

import { faPlus, faTrash, faScissors, faRotateLeft, faRotateRight, faCamera, faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons";
import type { Preferences } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { bindingFor, displayBinding } from "../editor/commands";
import type { Commands } from "../editor/commands";
import { Button, IconButton } from "./Controls";

export function TopActions({ commands, clock, preferences, mac }: { commands: Commands; clock: PlaybackClock; preferences: Preferences; mac: boolean }) {
   useClock(clock);
   return (
      <div className="top-actions">
         <IconButton icon={faPlus} label="Add clip in gap" disabled={!commands.add.enabled()} onClick={commands.add.run} />
         <IconButton
            icon={faTrash}
            label="Delete selected clip"
            disabled={!commands.delete.enabled()}
            onClick={commands.delete.run}
            shortcut={displayBinding(bindingFor("delete", preferences.shortcuts), mac)}
         />
         <Button
            icon={faScissors}
            data-command="split"
            disabled={!commands.split.enabled()}
            onClick={commands.split.run}
            shortcut={displayBinding(bindingFor("split", preferences.shortcuts), mac)}
         >
            Split
         </Button>
         <span className="control-divider" />
         <IconButton
            icon={faRotateLeft}
            label="Undo"
            data-command="undo"
            disabled={!commands.undo.enabled()}
            onClick={commands.undo.run}
            shortcut={displayBinding(bindingFor("undo", preferences.shortcuts), mac)}
         />
         <IconButton
            icon={faRotateRight}
            label="Redo"
            data-command="redo"
            disabled={!commands.redo.enabled()}
            onClick={commands.redo.run}
            shortcut={displayBinding(bindingFor("redo", preferences.shortcuts), mac)}
         />
         <span className="control-divider" />
         <IconButton icon={faCamera} label="Export current frame" disabled={!commands.frame.enabled()} onClick={commands.frame.run} />
         <Button variant="primary" icon={faArrowUpFromBracket} data-command="export" disabled={!commands.export.enabled()} onClick={commands.export.run}>
            Export
         </Button>
      </div>
   );
}

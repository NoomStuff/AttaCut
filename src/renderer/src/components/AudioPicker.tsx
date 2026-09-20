import type { MediaStream } from "../../../shared/types";
import { faHeadphones } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { audioTrackLabel } from "../playback/audioSelection";
import { DropdownSelect } from "./DropdownSelect";

export function AudioPicker({ tracks, selected, onSelect }: { tracks: MediaStream[]; selected: number[]; onSelect: (indices: number[]) => void }) {
   if (tracks.length <= 1) return null;
   const all = selected.length === tracks.length;
   return (
      <DropdownSelect
         label="Preview audio tracks"
         options={tracks.map((track, index) => ({ value: String(track.index), label: audioTrackLabel(track, index) }))}
         value={selected.map(String)}
         multiple
         required
         placement="up"
         className="audio-picker"
         onChange={(values) => onSelect(values.map(Number))}
         trigger={
            <>
               <FontAwesomeIcon icon={faHeadphones} />
               <b>{all ? "All" : selected.length}</b>
            </>
         }
      />
   );
}

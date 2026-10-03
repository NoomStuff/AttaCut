import type { MediaStream } from "../../../shared/types";
import { faHeadphones } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { audioTrackLabel } from "../playback/audioSelection";
import { DropdownSelect } from "./DropdownSelect";

export function AudioPicker({ tracks, selected, onSelect }: { tracks: MediaStream[]; selected: number[]; onSelect: (indices: number[]) => void }) {
   // One chosen track reads as its number; several show how many of the total play, since
   // "2" alone is ambiguous between the second track and two tracks. Every track is "All".
   const label =
      selected.length === tracks.length
         ? "All"
         : selected.length === 1
           ? String(tracks.findIndex((track) => track.index === selected[0]) + 1)
           : `${selected.length}/${tracks.length}`;
   return (
      <DropdownSelect
         label="Preview audio tracks"
         options={tracks.map((track, index) => ({ value: String(track.index), label: audioTrackLabel(track, index) }))}
         value={selected.map(String)}
         multiple
         required
         placement="up"
         disabled={tracks.length <= 1}
         className="audio-picker"
         tooltip="Preview audio tracks"
         onChange={(values) => onSelect(values.map(Number))}
         trigger={
            <>
               <FontAwesomeIcon icon={faHeadphones} />
               <b>{label}</b>
            </>
         }
      />
   );
}

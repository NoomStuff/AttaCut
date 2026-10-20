import { DropdownSelect } from "./DropdownSelect";
import { playbackSpeeds } from "../playback/speed";
import type { PlaybackSpeed } from "../playback/speed";

export function SpeedPicker({ speed, onChange }: { speed: PlaybackSpeed; onChange: (speed: PlaybackSpeed) => void }) {
   return (
      <DropdownSelect
         label="Playback speed"
         tooltip="Playback speed. Preview only."
         placement="up"
         className="speed-picker"
         value={[String(speed)]}
         options={playbackSpeeds.map((value) => ({ value: String(value), label: `${value}\u00d7` }))}
         trigger={`${speed}\u00d7`}
         onChange={(values) => {
            const selected = playbackSpeeds.find((value) => String(value) === values[0]);
            if (selected !== undefined) onChange(selected);
         }}
      />
   );
}

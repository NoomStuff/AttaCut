import { Fragment } from "react";
import type { Preferences } from "../../../shared/types";
import { bindingsFor, commandDefinitions, displayBindings } from "../editor/commands";
import type { CommandId, Commands } from "../editor/commands";
import { type PlaybackClock, useClock } from "../playback/clock";
import { useExitValue } from "../lib/motion";

export function NavDropdown({
   clock,
   open,
   sections,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   open: boolean;
   sections: CommandId[][];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   const presence = useExitValue(open ? true : null, 120);
   if (!presence.mounted) return null;
   return <NavDropdownItems clock={clock} closing={presence.closing} sections={sections} commands={commands} shortcuts={shortcuts} mac={mac} close={close} />;
}

function NavDropdownItems({
   clock,
   closing,
   sections,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   closing: boolean;
   sections: CommandId[][];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   // Subscribed only while mounted, so closed menus never tick with the clock.
   useClock(clock);
   return (
      <div className={`dropdown${closing ? " closing" : ""}`} role="menu">
         {sections.map((section, index) => (
            <Fragment key={index}>
               {index > 0 && <div className="dropdown-divider" role="separator" />}
               {section.map((id) => (
                  <button
                     role="menuitem"
                     key={id}
                     disabled={!commands[id].enabled()}
                     onClick={() => {
                        close();
                        commands[id].run();
                     }}
                  >
                     <span>{commandDefinitions[id].label}</span>
                     <kbd>{displayBindings(bindingsFor(id, shortcuts), mac)}</kbd>
                  </button>
               ))}
            </Fragment>
         ))}
      </div>
   );
}

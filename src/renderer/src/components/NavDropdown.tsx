import { Fragment, useEffect, useRef } from "react";
import type { Preferences } from "../../../shared/types";
import { bindingsFor, commandDefinitions, displayBindings } from "../editor/commands";
import type { CommandId, Commands } from "../editor/commands";
import { type PlaybackClock, useClock } from "../playback/clock";
import { useExitValue } from "../lib/motion";

export function NavDropdown({
   clock,
   open,
   focusLast,
   sections,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   open: boolean;
   focusLast: boolean;
   sections: CommandId[][];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   const presence = useExitValue(open ? true : null, 120);
   if (!presence.mounted) return null;
   return (
      <NavDropdownItems
         clock={clock}
         closing={presence.closing}
         focusLast={focusLast}
         sections={sections}
         commands={commands}
         shortcuts={shortcuts}
         mac={mac}
         close={close}
      />
   );
}

function NavDropdownItems({
   clock,
   closing,
   focusLast,
   sections,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   closing: boolean;
   focusLast: boolean;
   sections: CommandId[][];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   // Subscribed only while mounted, so closed menus never tick with the clock.
   useClock(clock);
   const root = useRef<HTMLDivElement>(null);
   // Focus after presence mounts the items. A frame scheduled by the trigger can run
   // before that mount, leaving keyboard users on the trigger with no selected item.
   useEffect(() => {
      if (closing) return;
      const items = root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (items?.length) items[focusLast ? items.length - 1 : 0]?.focus();
   }, [closing, focusLast]);
   return (
      <div
         ref={root}
         className={`dropdown${closing ? " closing" : ""}`}
         role="menu"
         inert={closing}
         onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) close();
         }}
         onKeyDown={(event) => {
            if (event.key === "Tab") close();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const target =
               event.key === "Home"
                  ? items[0]
                  : event.key === "End"
                    ? items.at(-1)
                    : event.key === "ArrowDown"
                      ? items[(index + 1) % items.length]
                      : event.key === "ArrowUp"
                        ? items[(index - 1 + items.length) % items.length]
                        : null;
            if (target) {
               event.preventDefault();
               event.stopPropagation();
               target.focus();
            }
            if (event.key === "Escape") {
               event.preventDefault();
               close();
               (event.currentTarget.parentElement?.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement | null)?.focus();
            }
         }}
      >
         {sections.map((section, index) => (
            <Fragment key={index}>
               {index > 0 && <div className="dropdown-divider" role="separator" />}
               {section.map((id) => (
                  <button
                     role="menuitem"
                     tabIndex={-1}
                     data-press-ignore
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

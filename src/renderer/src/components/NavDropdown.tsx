import { Fragment, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import type { RecentEntry } from "../../../shared/recent";
import type { Preferences } from "../../../shared/types";
import { bindingsFor, commandDefinitions, displayBindings } from "../editor/commands";
import type { CommandId, Commands } from "../editor/commands";
import { type PlaybackClock, useClock } from "../playback/clock";
import { useExitValue } from "../lib/motion";

export interface RecentMenu {
   files: RecentEntry[];
   open: (path: string) => void;
   clear: () => void;
}
/** Only the top-level items take part in the menu's arrow keys; the flyout handles its own. */
const topItems = ":scope > button:not(:disabled), :scope > .dropdown-submenu > button:not(:disabled)";

export function NavDropdown({
   clock,
   open,
   focusLast,
   sections,
   commands,
   shortcuts,
   mac,
   recent,
   close,
}: {
   recent?: RecentMenu | undefined;
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
         recent={recent}
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
   recent,
   close,
}: {
   recent?: RecentMenu | undefined;
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
      const items = root.current?.querySelectorAll<HTMLButtonElement>(topItems);
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
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(topItems)];
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
                  <Fragment key={id}>
                     <button
                        role="menuitem"
                        tabIndex={-1}
                        data-press-ignore
                        disabled={!commands[id].enabled()}
                        onClick={() => {
                           close();
                           commands[id].run();
                        }}
                     >
                        <span>{commandDefinitions[id].label}</span>
                        <kbd>{displayBindings(bindingsFor(id, shortcuts), mac)}</kbd>
                     </button>
                     {id === "open" && recent && <RecentSubmenu recent={recent} close={close} />}
                  </Fragment>
               ))}
            </Fragment>
         ))}
      </div>
   );
}

function RecentSubmenu({ recent, close }: { recent: RecentMenu; close: () => void }) {
   const [open, setOpen] = useState(false);
   const trigger = useRef<HTMLButtonElement>(null);
   const flyout = useRef<HTMLDivElement>(null);
   const items = () => [...(flyout.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
   // Opening from the keyboard lands on the first entry, like any nested menu.
   const openWithFocus = () => {
      setOpen(true);
      requestAnimationFrame(() => items()[0]?.focus());
   };
   return (
      <div className="dropdown-submenu" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
         <button
            ref={trigger}
            role="menuitem"
            tabIndex={-1}
            data-press-ignore
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={openWithFocus}
            onKeyDown={(event) => {
               if (event.key !== "ArrowRight") return;
               event.preventDefault();
               event.stopPropagation();
               openWithFocus();
            }}
         >
            <span>Open recent</span>
            <FontAwesomeIcon icon={faChevronRight} />
         </button>
         {open && (
            <div
               ref={flyout}
               className="dropdown dropdown-flyout"
               role="menu"
               aria-label="Open recent"
               onKeyDown={(event) => {
                  const list = items();
                  const index = list.indexOf(document.activeElement as HTMLButtonElement);
                  const next =
                     event.key === "ArrowDown"
                        ? list[(index + 1) % list.length]
                        : event.key === "ArrowUp"
                          ? list[(index - 1 + list.length) % list.length]
                          : null;
                  if (next) next.focus();
                  if (event.key === "ArrowLeft" || event.key === "Escape") {
                     setOpen(false);
                     trigger.current?.focus();
                  }
                  if (next || ["ArrowLeft", "Escape", "Home", "End"].includes(event.key)) {
                     event.preventDefault();
                     event.stopPropagation();
                  }
               }}
            >
               {recent.files.length ? (
                  <>
                     {recent.files.map((file) => (
                        <button
                           key={file.path}
                           role="menuitem"
                           tabIndex={-1}
                           data-press-ignore
                           disabled={file.missing}
                           title={file.missing ? `Not found: ${file.path}` : file.path}
                           onClick={() => {
                              close();
                              recent.open(file.path);
                           }}
                        >
                           <span className="recent-menu-name">{file.name}</span>
                           <kbd>{file.missing ? "Not found" : file.directory.split(/[\\/]/).filter(Boolean).pop()}</kbd>
                        </button>
                     ))}
                     <div className="dropdown-divider" role="separator" />
                     <button
                        role="menuitem"
                        tabIndex={-1}
                        data-press-ignore
                        onClick={() => {
                           close();
                           recent.clear();
                        }}
                     >
                        <span>Clear recent</span>
                     </button>
                  </>
               ) : (
                  <button role="menuitem" tabIndex={-1} disabled>
                     <span>No recent files</span>
                  </button>
               )}
            </div>
         )}
      </div>
   );
}

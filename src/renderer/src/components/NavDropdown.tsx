import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
   faArrowsLeftRightToLine,
   faArrowsRotate,
   faArrowUpFromBracket,
   faArrowUpRightFromSquare,
   faBroom,
   faCamera,
   faCaretLeft,
   faCaretRight,
   faChevronRight,
   faCircleInfo,
   faCirclePlay,
   faCircleQuestion,
   faClockRotateLeft,
   faCrosshairs,
   faExpand,
   faFileLines,
   faFilePen,
   faFilm,
   faFloppyDisk,
   faFolderOpen,
   faGear,
   faKeyboard,
   faLink,
   faMagnifyingGlassMinus,
   faMagnifyingGlassPlus,
   faPlus,
   faPowerOff,
   faRectangleXmark,
   faRotateLeft,
   faRotateRight,
   faScissors,
   faTrashCan,
   faTriangleExclamation,
   faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
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
const menuIcons: Partial<Record<CommandId, IconDefinition>> = {
   open: faFolderOpen,
   frame: faCamera,
   export: faArrowUpFromBracket,
   saveProject: faFloppyDisk,
   saveProjectAs: faFilePen,
   closeProject: faRectangleXmark,
   quit: faPowerOff,
   undo: faRotateLeft,
   redo: faRotateRight,
   split: faScissors,
   merge: faLink,
   autoDetectCuts: faWandMagicSparkles,
   setStart: faCaretLeft,
   setEnd: faCaretRight,
   add: faPlus,
   delete: faTrashCan,
   preview: faCirclePlay,
   settings: faGear,
   options: faGear,
   zoomIn: faMagnifyingGlassPlus,
   zoomOut: faMagnifyingGlassMinus,
   fit: faArrowsLeftRightToLine,
   focusClip: faCrosshairs,
   fullscreen: faExpand,
   help: faCircleQuestion,
   shortcuts: faKeyboard,
   about: faCircleInfo,
   updates: faArrowsRotate,
   releases: faArrowUpRightFromSquare,
   reset: faTriangleExclamation,
};

/** A menu item's leading icon and label. Menu icons stay still; only toolbar icons animate. */
function MenuLabel({ icon, children, className }: { icon: IconDefinition | undefined; children: ReactNode; className?: string }) {
   return (
      <span className="menu-label">
         <span className="menu-icon" aria-hidden="true">
            {icon && <FontAwesomeIcon icon={icon} />}
         </span>
         <span className={className}>{children}</span>
      </span>
   );
}

/** How long the flyout survives a pointer that left toward it but stopped moving. */
const aimGraceMs = 450;
/** How long the flyout survives a pointer leaving it in any other direction. */
const leaveGraceMs = 250;

type Point = { x: number; y: number };
const side = (p: Point, a: Point, b: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
/** True when p lies in the triangle from the exit point to the flyout's near edge. */
function aiming(p: Point, from: Point, flyout: DOMRect): boolean {
   // A little slack behind the exit point and past the flyout's corners absorbs hand jitter.
   const apex = { x: from.x - 6, y: from.y };
   const top = { x: flyout.left, y: flyout.top - 8 };
   const bottom = { x: flyout.left, y: flyout.bottom + 8 };
   const d1 = side(p, apex, top);
   const d2 = side(p, top, bottom);
   const d3 = side(p, bottom, apex);
   return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
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
                        <MenuLabel icon={menuIcons[id]}>{commandDefinitions[id].label}</MenuLabel>
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
   const presence = useExitValue(open ? true : null, 110);
   const trigger = useRef<HTMLButtonElement>(null);
   const flyout = useRef<HTMLDivElement>(null);
   const closeTimer = useRef(0);
   const exit = useRef<Point | null>(null);
   const items = () => [...(flyout.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
   const stay = () => {
      window.clearTimeout(closeTimer.current);
      exit.current = null;
   };
   const closeAfter = (ms: number) => {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
         exit.current = null;
         setOpen(false);
      }, ms);
   };
   // Opening from the keyboard lands on the first entry, like any nested menu.
   const openWithFocus = () => {
      stay();
      setOpen(true);
      requestAnimationFrame(() => items()[0]?.focus());
   };
   useEffect(() => () => window.clearTimeout(closeTimer.current), []);
   // Once the pointer leaves toward the flyout, it stays open while the pointer keeps heading
   // for it, however slow or diagonal the path, and closes as soon as the pointer turns away.
   useEffect(() => {
      if (!open) return;
      const move = (event: PointerEvent) => {
         const from = exit.current;
         const box = flyout.current?.getBoundingClientRect();
         if (!from || !box || from.x >= box.left) return;
         if (aiming({ x: event.clientX, y: event.clientY }, from, box)) {
            closeAfter(aimGraceMs);
            return;
         }
         stay();
         setOpen(false);
      };
      window.addEventListener("pointermove", move);
      return () => window.removeEventListener("pointermove", move);
   }, [open]);
   return (
      <div
         className="dropdown-submenu"
         onPointerEnter={() => {
            stay();
            setOpen(true);
         }}
         onPointerLeave={(event) => {
            if (!open) return;
            exit.current = { x: event.clientX, y: event.clientY };
            const box = flyout.current?.getBoundingClientRect();
            closeAfter(box && event.clientX < box.left ? aimGraceMs : leaveGraceMs);
         }}
      >
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
            <MenuLabel icon={faClockRotateLeft}>Open recent</MenuLabel>
            <FontAwesomeIcon className="submenu-chevron" icon={faChevronRight} />
         </button>
         {presence.mounted && (
            <div
               ref={flyout}
               className={`dropdown dropdown-flyout${presence.closing ? " closing" : ""}`}
               role="menu"
               inert={presence.closing}
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
                           <MenuLabel icon={file.kind === "project" ? faFileLines : faFilm} className="recent-menu-name">
                              {file.name}
                           </MenuLabel>
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
                        <MenuLabel icon={faBroom}>Clear recent</MenuLabel>
                     </button>
                  </>
               ) : (
                  <button role="menuitem" tabIndex={-1} disabled>
                     <MenuLabel icon={undefined}>No recent files</MenuLabel>
                  </button>
               )}
            </div>
         )}
      </div>
   );
}

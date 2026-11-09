import { useEffect, useState } from "react";
import type { Preferences } from "../../../shared/types";
import type { CommandId, Commands } from "../editor/commands";
import type { PlaybackClock } from "../playback/clock";
import { NavDropdown, type RecentMenu } from "./NavDropdown";

const menuSections: Record<string, CommandId[][]> = {
   File: [["open"], ["frame", "export"], ["saveProject", "saveProjectAs", "closeProject"], ["quit"]],
   Edit: [
      ["undo", "redo"],
      ["split", "merge", "autoDetectCuts"],
      ["setStart", "setEnd", "add", "delete", "invert"],
      ["copyChapters", "copyCsv"],
      ["preview"],
      ["settings"],
   ],
   View: [["zoomIn", "zoomOut", "fit", "focusClip"], ["preview"], ["fullscreen"], ["options"]],
   Help: [["help", "shortcuts", "about"], ["updates", "releases"], ["reset"]],
};

/** The in-app menu bar. The open menu lives with the caller, since shortcuts yield to it. */
export function MenuBar({
   menu,
   onMenu,
   commands,
   clock,
   shortcuts,
   mac,
   recent,
}: {
   menu: string | null;
   onMenu: (menu: string | null) => void;
   commands: Commands;
   clock: PlaybackClock;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   recent: RecentMenu;
}) {
   const [focusLast, setFocusLast] = useState(false);
   useEffect(() => {
      if (!menu) return;
      const close = (event: PointerEvent) => {
         if (!(event.target instanceof Element && event.target.closest("[data-menu]"))) onMenu(null);
      };
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") onMenu(null);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", escape);
      return () => {
         window.removeEventListener("pointerdown", close);
         window.removeEventListener("keydown", escape);
      };
   }, [menu, onMenu]);
   return (
      <nav aria-label="Application menu">
         {Object.entries(menuSections).map(([name, sections]) => (
            <div className="app-menu" key={name} data-menu>
               <button
                  aria-haspopup="menu"
                  aria-expanded={menu === name}
                  onClick={() => {
                     setFocusLast(false);
                     onMenu(menu === name ? null : name);
                  }}
                  onKeyDown={(event) => {
                     if (event.key === "Tab") onMenu(null);
                     if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                     event.preventDefault();
                     setFocusLast(event.key === "ArrowUp");
                     onMenu(name);
                  }}
               >
                  {name}
               </button>
               <NavDropdown
                  clock={clock}
                  open={menu === name}
                  focusLast={focusLast}
                  sections={sections}
                  commands={commands}
                  shortcuts={shortcuts}
                  mac={mac}
                  recent={name === "File" ? recent : undefined}
                  close={() => onMenu(null)}
               />
            </div>
         ))}
      </nav>
   );
}

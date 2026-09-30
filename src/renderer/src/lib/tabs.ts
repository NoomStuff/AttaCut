import type { KeyboardEvent } from "react";

export function navigateTabs(event: KeyboardEvent<HTMLDivElement>): void {
   const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
   const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
   const target =
      event.key === "Home"
         ? tabs[0]
         : event.key === "End"
           ? tabs.at(-1)
           : event.key === "ArrowRight"
             ? tabs[(index + 1) % tabs.length]
             : event.key === "ArrowLeft"
               ? tabs[(index - 1 + tabs.length) % tabs.length]
               : null;
   if (!target) return;
   event.preventDefault();
   target.click();
   target.focus();
}

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { faCheck, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { TooltipHost } from "./Controls";
import { useExitValue } from "../lib/motion";

export interface DropdownOption {
   value: string;
   label: string;
}

export function DropdownSelect({
   label,
   options,
   value,
   onChange,
   multiple = false,
   required = false,
   disabled = false,
   placement = "down",
   trigger,
   tooltip,
   className = "",
}: {
   label: string;
   options: DropdownOption[];
   value: string[];
   onChange: (value: string[]) => void;
   multiple?: boolean;
   required?: boolean;
   disabled?: boolean;
   placement?: "up" | "down";
   trigger: ReactNode;
   /** Shows the standard hover tooltip; omit for selects whose trigger already explains itself. */
   tooltip?: string;
   className?: string;
}) {
   const [open, setOpen] = useState(false);
   const root = useRef<HTMLDivElement>(null);
   const tooltipId = useId();
   const presence = useExitValue(open ? true : null, 120);
   useEffect(() => {
      if (!open) return;
      root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
      const outside = (event: PointerEvent) => {
         if (!root.current?.contains(event.target as Node)) setOpen(false);
      };
      window.addEventListener("pointerdown", outside);
      return () => window.removeEventListener("pointerdown", outside);
   }, [open]);
   const close = () => {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".select-trigger")?.focus();
   };
   const triggerButton = (
      <button
         type="button"
         className="select-trigger"
         aria-label={label}
         aria-describedby={tooltip ? tooltipId : undefined}
         aria-haspopup="listbox"
         aria-expanded={open}
         disabled={disabled || options.length === 0}
         onClick={() => setOpen((current) => !current)}
      >
         <span>{trigger}</span>
         <FontAwesomeIcon className="select-chevron" icon={faChevronDown} />
      </button>
   );
   return (
      <div className={`custom-select ${placement} ${className}`} ref={root}>
         {tooltip ? (
            <TooltipHost>
               {triggerButton}
               <span role="tooltip" id={tooltipId} className="tooltip">
                  {tooltip}
               </span>
            </TooltipHost>
         ) : (
            triggerButton
         )}
         {presence.mounted && presence.value && (
            <div
               className={`select-menu${presence.closing ? " closing" : ""}`}
               role="listbox"
               aria-label={label}
               aria-multiselectable={multiple || undefined}
               onKeyDown={(event) => {
                  if (event.key === "Escape") {
                     event.stopPropagation();
                     close();
                  }
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                     event.preventDefault();
                     event.stopPropagation();
                     const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
                     const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                     buttons[
                        event.key === "Home"
                           ? 0
                           : event.key === "End"
                             ? buttons.length - 1
                             : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
                     ]?.focus();
                  }
               }}
            >
               {options.map((option) => {
                  const selected = value.includes(option.value);
                  const cannotClear = multiple && required && selected && value.length === 1;
                  return (
                     <button
                        type="button"
                        key={option.value}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={cannotClear || undefined}
                        disabled={cannotClear}
                        onClick={() => {
                           if (multiple) onChange(selected ? value.filter((item) => item !== option.value) : [...value, option.value]);
                           else {
                              onChange([option.value]);
                              close();
                           }
                        }}
                     >
                        <span>{option.label}</span>
                        <span className="select-check" aria-hidden="true">
                           {selected && <FontAwesomeIcon icon={faCheck} />}
                        </span>
                     </button>
                  );
               })}
            </div>
         )}
      </div>
   );
}

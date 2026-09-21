import { CommandContext, commandDefinitions, bindingsFor, displayBindings } from "../editor/commands";
import type { CommandId } from "../editor/commands";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

function TooltipHost({ children }: { children: ReactNode }) {
   const ref = useRef<HTMLSpanElement>(null);
   const [hovered, setHovered] = useState(false);
   const [focused, setFocused] = useState(false);
   const active = hovered || focused;
   useLayoutEffect(() => {
      if (!active) return;
      const host = ref.current!;
      const tooltip = host.querySelector<HTMLElement>(".tooltip")!;
      const position = () => {
         tooltip.style.removeProperty("--tooltip-shift");
         const rect = tooltip.getBoundingClientRect();
         const margin = 8;
         const left = Math.max(margin, Math.min(rect.left, document.documentElement.clientWidth - rect.width - margin));
         tooltip.style.setProperty("--tooltip-shift", `${left - rect.left}px`);
      };
      position();
      const observer = new ResizeObserver(position);
      observer.observe(host);
      observer.observe(tooltip);
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      return () => {
         observer.disconnect();
         window.removeEventListener("resize", position);
         window.removeEventListener("scroll", position, true);
      };
   }, [active]);
   return (
      <span
         ref={ref}
         className="tooltip-host"
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => setHovered(false)}
         onFocus={() => setFocused(true)}
         onBlur={() => setFocused(false)}
      >
         {children}
      </span>
   );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   command?: CommandId | undefined;
   icon?: IconDefinition;
   shortcut?: string;
   active?: boolean;
   variant?: "primary" | "secondary" | "quiet" | "danger";
}
export function Button({ command, icon, shortcut, active, variant = "quiet", children, className = "", ...props }: ButtonProps) {
   const context = useContext(CommandContext);
   const tooltipId = useId();
   const action = command && context ? context.commands[command] : null;
   if (command && context) shortcut ??= displayBindings(bindingsFor(command, context.overrides).slice(0, 1), context.mac);
   const button = (
      <button
         aria-label={typeof children === "string" ? children : undefined}
         aria-describedby={command && children !== undefined ? tooltipId : undefined}
         data-command={command}
         disabled={action ? !action.enabled() : undefined}
         onClick={action?.run}
         {...props}
         className={`button ${variant} ${active ? "active" : ""} ${className}`}
      >
         {icon && <FontAwesomeIcon icon={icon} />}
         <span>{children}</span>
         {shortcut && <kbd>{shortcut}</kbd>}
      </button>
   );
   if (!command || !context || children === undefined) return button;
   const binding = displayBindings(bindingsFor(command, context.overrides), context.mac);
   return (
      <TooltipHost>
         {button}
         <span role="tooltip" id={tooltipId} className="tooltip">
            {commandDefinitions[command].label}
            {binding && <kbd>{binding}</kbd>}
         </span>
      </TooltipHost>
   );
}
interface IconButtonProps extends Omit<ButtonProps, "icon"> {
   icon: IconDefinition;
   label: string;
}
export function IconButton({ command, icon, label, shortcut, className = "", ...props }: IconButtonProps) {
   const context = useContext(CommandContext);
   if (command && context) shortcut ??= displayBindings(bindingsFor(command, context.overrides), context.mac);
   const id = useId();
   return (
      <TooltipHost>
         <Button command={command} shortcut="" {...props} aria-label={label} aria-describedby={id} icon={icon} className={`icon-button ${className}`} />
         <span role="tooltip" id={id} className="tooltip">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
         </span>
      </TooltipHost>
   );
}
export function Modal({
   title,
   description,
   headerIcon,
   onClose,
   children,
   className = "",
   closeDisabled = false,
}: {
   title: string;
   description?: string;
   headerIcon?: ReactNode;
   onClose: () => void;
   children: ReactNode;
   className?: string;
   closeDisabled?: boolean;
}) {
   const ref = useRef<HTMLDialogElement>(null);
   const titleId = useId();
   const [closing, setClosing] = useState(false);
   const timer = useRef(0);
   useEffect(() => {
      const dialog = ref.current!;
      dialog.showModal();
      dialog.focus();
      return () => {
         window.clearTimeout(timer.current);
         dialog.close();
      };
   }, []);
   // Play the exit animation before the panel unmounts. The dialog itself closes natively
   // right away: its backdrop ignores pointer-events while fading and would swallow a click
   // aimed at the app behind it.
   const requestClose = () => {
      if (closing || closeDisabled) return;
      setClosing(true);
      ref.current?.close();
      timer.current = window.setTimeout(onClose, 140);
   };
   return (
      <dialog
         ref={ref}
         className={`modal ${className}${closing ? " closing" : ""}`}
         tabIndex={-1}
         aria-labelledby={titleId}
         onCancel={(event) => {
            event.preventDefault();
            requestClose();
         }}
         onClick={(event) => {
            if (event.target === event.currentTarget) {
               const rect = event.currentTarget.getBoundingClientRect();
               if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
            }
         }}
      >
         <div className="modal-header">
            {headerIcon && (
               <div className="modal-header-icon" aria-hidden="true">
                  {headerIcon}
               </div>
            )}
            <div>
               <h2 id={titleId}>{title}</h2>
               {description && <p>{description}</p>}
            </div>
            <IconButton icon={faXmark} label="Close panel" disabled={closeDisabled} onClick={requestClose} />
         </div>
         {children}
      </dialog>
   );
}
export function Toggle({
   label,
   checked,
   onChange,
   description,
   disabled,
}: {
   label: string;
   checked: boolean;
   onChange: (checked: boolean) => void;
   description?: string;
   disabled?: boolean;
}) {
   const descriptionId = useId();
   return (
      <label className="toggle-row">
         <span>
            {label}
            {description && <small id={descriptionId}>{description}</small>}
         </span>
         <input
            type="checkbox"
            role="switch"
            aria-label={label}
            aria-describedby={description ? descriptionId : undefined}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
         />
         <span className="switch" aria-hidden="true" />
      </label>
   );
}

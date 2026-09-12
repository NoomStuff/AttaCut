import { CommandContext, commandDefinitions, bindingsFor, displayBindings } from "../editor/commands";
import type { CommandId } from "../editor/commands";
import { useContext, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   command?: CommandId | undefined;
   icon?: IconDefinition;
   shortcut?: string;
   active?: boolean;
   variant?: "primary" | "quiet" | "danger";
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
      <span className="tooltip-host">
         {button}
         <span role="tooltip" id={tooltipId} className="tooltip">
            {commandDefinitions[command].label}
            {binding && <kbd>{binding}</kbd>}
         </span>
      </span>
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
      <span className="tooltip-host">
         <Button command={command} shortcut="" {...props} aria-label={label} aria-describedby={id} icon={icon} className={`icon-button ${className}`} />
         <span role="tooltip" id={id} className="tooltip">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
         </span>
      </span>
   );
}
export function Modal({
   title,
   description,
   onClose,
   children,
   className = "",
}: {
   title: string;
   description?: string;
   onClose: () => void;
   children: ReactNode;
   className?: string;
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
   // Play the exit animation before the panel unmounts.
   const requestClose = () => {
      if (closing) return;
      setClosing(true);
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
            <div>
               <h2 id={titleId}>{title}</h2>
               {description && <p>{description}</p>}
            </div>
            <IconButton icon={faXmark} label="Close panel" onClick={requestClose} />
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

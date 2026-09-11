import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   icon?: IconDefinition;
   shortcut?: string;
   active?: boolean;
   variant?: "primary" | "quiet" | "danger";
}
export function Button({ icon, shortcut, active, variant = "quiet", children, className = "", ...props }: ButtonProps) {
   return (
      <button {...props} className={`button ${variant} ${active ? "active" : ""} ${className}`}>
         {icon && <FontAwesomeIcon icon={icon} />}
         <span>{children}</span>
         {shortcut && <kbd>{shortcut}</kbd>}
      </button>
   );
}
interface IconButtonProps extends Omit<ButtonProps, "icon"> {
   icon: IconDefinition;
   label: string;
}
export function IconButton({ icon, label, shortcut, className = "", ...props }: IconButtonProps) {
   const id = useId();
   return (
      <span className="tooltip-host">
         <Button {...props} aria-label={label} aria-describedby={id} icon={icon} className={`icon-button ${className}`} />
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

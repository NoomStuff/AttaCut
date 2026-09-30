import { faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { Button } from "./Controls";

export function OutputDirectoryField({
   value,
   onChange,
   onError,
   disabled = false,
   id,
   label,
   className,
}: {
   value: string;
   onChange: (value: string) => void;
   onError: (error: unknown) => void;
   disabled?: boolean;
   id?: string;
   label?: string;
   className: string;
}) {
   return (
      <div className={className}>
         <input id={id} aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
         <Button
            variant="secondary"
            icon={faFolderOpen}
            disabled={disabled}
            onClick={() => {
               void window.desktop
                  .chooseDirectory(value)
                  .then((path) => {
                     if (path) onChange(path);
                  })
                  .catch(onError);
            }}
         >
            Browse
         </Button>
      </div>
   );
}

import type { CSSProperties } from "react";
import "./SegmentedControl.css";

/** Shared sliding selection used by export mode and the detection panel. */
export function SegmentedControl<T extends string>({
   label,
   options,
   value,
   onChange,
   disabled = false,
   className = "",
}: {
   label: string;
   options: readonly { value: T; label: string; disabled?: boolean; title?: string }[];
   value: T;
   onChange: (value: T) => void;
   disabled?: boolean;
   className?: string;
}) {
   return (
      <div
         className={`segmented-control ${className}`}
         role="group"
         aria-label={label}
         aria-disabled={disabled}
         style={
            {
               "--segment-count": options.length,
               "--segment-index": Math.max(
                  0,
                  options.findIndex((option) => option.value === value)
               ),
            } as CSSProperties
         }
      >
         {options.map((option) => (
            <button
               key={option.value}
               disabled={disabled || option.disabled}
               title={option.title}
               aria-pressed={value === option.value}
               onClick={() => {
                  if (value !== option.value) onChange(option.value);
               }}
            >
               {option.label}
            </button>
         ))}
      </div>
   );
}

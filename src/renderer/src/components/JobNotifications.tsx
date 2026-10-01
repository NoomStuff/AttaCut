import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ExportJob } from "../../../shared/types";
import { JobProgress } from "./JobProgress";

export function JobNotifications({
   jobs,
   currentJob,
   onDismiss,
   onError,
   onRetry,
}: {
   jobs: ExportJob[];
   currentJob: ExportJob | null;
   onDismiss: (id: string) => void;
   onError: (message: string) => void;
   onRetry: (job: ExportJob) => void;
}) {
   const root = useRef<HTMLElement>(null);
   const scroll = useRef<HTMLDivElement>(null);
   const [hovered, setHovered] = useState(false);
   const [focused, setFocused] = useState(false);
   const [pinned, setPinned] = useState(false);
   const [collapsed, setCollapsed] = useState(false);
   const [heights, setHeights] = useState<Record<string, number>>({});
   const signature = jobs.map((job) => job.id).join(",");
   useLayoutEffect(() => {
      const entries = root.current?.querySelectorAll<HTMLElement>(".notification-entry");
      if (!entries?.length) return;
      const measure = () => {
         const next = Object.fromEntries([...entries].map((entry) => [entry.dataset["jobId"]!, entry.offsetHeight]));
         setHeights((current) =>
            Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([id, height]) => current[id] === height) ? current : next
         );
      };
      measure();
      const observer = new ResizeObserver(measure);
      entries.forEach((entry) => observer.observe(entry));
      return () => observer.disconnect();
   }, [signature]);
   const expanded = jobs.length > 1 && !collapsed && (hovered || focused || pinned);
   const heightFor = (job: ExportJob) => heights[job.id] ?? 150;
   const totalHeight = expanded
      ? jobs.reduce((sum, job) => sum + heightFor(job) + 10, -10)
      : jobs[0]
        ? heightFor(jobs[0]) + Math.min(jobs.length - 1, 2) * 8
        : 0;
   useLayoutEffect(() => {
      // Keep the newest card at the bottom in view throughout the expansion.
      const list = scroll.current;
      if (!list) return;
      const until = performance.now() + 250;
      let frame = 0;
      const keepLatestVisible = () => {
         list.scrollTop = list.scrollHeight;
         if (performance.now() < until) frame = requestAnimationFrame(keepLatestVisible);
      };
      keepLatestVisible();
      return () => cancelAnimationFrame(frame);
   }, [expanded, signature, totalHeight]);
   if (!jobs.length) return null;
   let offset = 0;
   return (
      <section
         className="job-notifications"
         ref={root}
         aria-label="Exports"
         data-expanded={expanded}
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => {
            setHovered(false);
            setCollapsed(false);
         }}
         onFocusCapture={() => setFocused(true)}
         onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
         }}
         onKeyDown={(event) => {
            if (event.key === "Escape") {
               setPinned(false);
               setCollapsed(true);
               setHovered(false);
               if (event.target instanceof HTMLElement) event.target.blur();
               event.stopPropagation();
            }
         }}
      >
         {jobs.length > 1 && (
            <button
               className="notification-toggle"
               data-press-ignore
               aria-expanded={expanded}
               aria-label={expanded ? "Collapse export notifications" : "Expand export notifications"}
               onClick={() => {
                  setPinned(!expanded);
                  setCollapsed(expanded);
               }}
            >
               {jobs.length} exports
            </button>
         )}
         <div className="notification-scroll" ref={scroll}>
            <div className="notification-list" style={{ height: totalHeight }}>
               {jobs.map((job, index) => {
                  const bottom = expanded ? offset : Math.min(index, 2) * 8;
                  offset += heightFor(job) + 10;
                  return (
                     <div
                        key={job.id}
                        className="notification-entry"
                        data-job-id={job.id}
                        data-back={!expanded && index > 0}
                        inert={!expanded && index > 0}
                        style={
                           {
                              bottom,
                              zIndex: jobs.length - index,
                              "--stack-scale": expanded ? 1 : 1 - Math.min(index, 2) * 0.025,
                              "--stack-opacity": expanded || index < 3 ? 1 : 0,
                           } as CSSProperties
                        }
                     >
                        <JobProgress
                           job={job}
                           closing={false}
                           onDismiss={() => onDismiss(job.id)}
                           onError={onError}
                           onRetry={onRetry}
                           retryAvailable={currentJob?.id === job.id && !currentJob.running}
                        />
                     </div>
                  );
               })}
            </div>
         </div>
      </section>
   );
}

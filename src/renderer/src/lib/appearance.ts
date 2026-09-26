import { useEffect } from "react";
import type { Preferences } from "../../../shared/types";
import { clipColorCount } from "../../../shared/defaults";

export function useAppearance(preferences: Preferences): void {
   useEffect(() => {
      const system = window.matchMedia("(prefers-color-scheme: dark)");
      const applyTheme = () => {
         document.documentElement.dataset["theme"] = preferences.theme === "system" ? (system.matches ? "dark" : "light") : preferences.theme;
      };
      applyTheme();
      system.addEventListener("change", applyTheme);
      return () => system.removeEventListener("change", applyTheme);
   }, [preferences.theme]);
   useEffect(() => {
      document.documentElement.style.setProperty("--accent", `var(--clip-${preferences.accent})`);
      for (let index = 0; index < clipColorCount; index++) {
         document.documentElement.style.setProperty(`--clip-sequence-${index}`, `var(--clip-${(index + preferences.accent) % clipColorCount})`);
      }
   }, [preferences.accent]);
}

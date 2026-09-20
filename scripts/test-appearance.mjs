import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";

await mkdir("work/screenshots", { recursive: true });
const profile = await mkdtemp(resolve("work/appearance-profile-"));
const launch = () => electron.launch({ args: ["."], env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: "" } });
const application = await launch();
try {
   const page = await application.firstWindow();
   await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
   await page.keyboard.press("Control+,");
   await page.getByRole("dialog", { name: "Settings" }).waitFor();
   await expect(page.getByRole("button", { name: "Dark theme", exact: true })).toHaveAttribute("aria-pressed", "true");
   await expect(page.getByRole("group", { name: "Appearance" }).getByRole("button")).toHaveCount(3);
   await expect(page.getByRole("group", { name: "Accent colour" }).getByRole("button")).toHaveCount(5);
   for (const theme of ["Light", "Dark"]) {
      await page.getByRole("button", { name: `${theme} theme`, exact: true }).click();
      for (const [index, name] of ["Blue", "Purple", "Green", "Amber", "Red"].entries()) {
         await page.getByRole("button", { name: `${name} accent`, exact: true }).click();
         await expect(page.getByRole("button", { name: `${name} accent`, exact: true })).toHaveAttribute("aria-pressed", "true");
         const contrast = await page.evaluate((index) => {
            const root = globalThis.getComputedStyle(document.documentElement);
            const probe = document.createElement("span");
            document.body.append(probe);
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d");
            const rgb = (color) => {
               probe.style.color = color;
               context.fillStyle = globalThis.getComputedStyle(probe).color;
               context.fillRect(0, 0, 1, 1);
               return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
            };
            const luminance = (color) =>
               rgb(color)
                  .map((v) => v / 255)
                  .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const ratio = (a, b) => {
               const x = luminance(a),
                  y = luminance(b);
               return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            };
            const accent = root.getPropertyValue("--accent").trim();
            const clip = root.getPropertyValue(`--clip-${index}`).trim();
            const result = {
               matches: rgb(accent).join() === rgb(clip).join(),
               rotation: Array.from(
                  { length: 5 },
                  (_, offset) => rgb(`var(--clip-sequence-${offset})`).join() === rgb(`var(--clip-${(index + offset) % 5})`).join()
               ).every(Boolean),
               button: ratio(accent, root.getPropertyValue("--accent-text")),
               text: ratio(accent, root.getPropertyValue("--surface")),
               neutrals: ["--text", "--muted", "--faint"].map((token) => ratio(root.getPropertyValue(token), root.getPropertyValue("--background"))),
            };
            probe.remove();
            return result;
         }, index);
         expect(contrast.matches).toBe(true);
         expect(contrast.rotation).toBe(true);
         expect(contrast.button).toBeGreaterThanOrEqual(4.5);
         expect(contrast.text).toBeGreaterThanOrEqual(4.5);
         if (theme === "Light") for (const ratio of contrast.neutrals) expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({ path: `work/screenshots/appearance-${theme.toLowerCase()}.png` });
   }
   await page.getByRole("button", { name: "System theme", exact: true }).click();
   for (const colorScheme of ["light", "dark", "light"]) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect(page.getByRole("button", { name: "System theme", exact: true })).toHaveAttribute("aria-pressed", "true");
   }
   await page.getByRole("button", { name: "Light theme", exact: true }).click();
   await page.emulateMedia({ colorScheme: "dark" });
   await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
   await page.getByRole("button", { name: "Blue accent", exact: true }).click();
   await page.getByRole("button", { name: "Close panel", exact: true }).click();
   await page.getByRole("dialog").waitFor({ state: "detached" });
   await page.screenshot({ path: "work/screenshots/appearance-empty.png" });
} finally {
   await application.close();
}
const restored = await launch();
try {
   const page = await restored.firstWindow();
   await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
   await page.keyboard.press("Control+,");
   await expect(page.getByRole("button", { name: "Blue accent", exact: true })).toHaveAttribute("aria-pressed", "true");
   console.log("Appearance passed: defaults, all accents, contrast, live system changes, explicit override, and persistence.");
} finally {
   await restored.close();
}

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { test, configureIpc, mediaBinary, waitForVideo } from "./app.mjs";

const fixture = resolve("work/scenes/ui-cuts.mp4");
const manyCutsFixture = resolve("work/scenes/ui-many-cuts.mp4");
test.beforeAll(() => {
   mkdirSync(resolve("work/scenes"), { recursive: true });
   for (const [path, expression] of [
      [fixture, "gte(t,1)*lt(t,2)+gte(t,2.8)"],
      [manyCutsFixture, "mod(floor(t*5),2)"],
   ]) {
      execFileSync(
         mediaBinary("ffmpeg"),
         [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            `color=black:s=160x90:r=25:d=3,drawbox=color=white:t=fill:enable='${expression}'`,
            "-c:v",
            "libx264",
            "-g",
            "250",
            "-sc_threshold",
            "0",
            path,
         ],
         { windowsHide: true }
      );
   }
});

test("scene detection splits all scenes in one undoable edit and the outro can be deleted", async ({ launchApp, profile }, testInfo) => {
   const app = await launchApp(profile, fixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await configureIpc(app, "source:scenes", { after: "scene-layout" });
   const ranges = page.locator(".clip-range:not(.exiting)");
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const dialog = page.getByRole("dialog", { name: "Auto detect cuts" });
   await dialog.screenshot({ path: testInfo.outputPath("scene-cuts-scanning.png") });
   const anchors = [
      dialog,
      dialog.getByRole("group", { name: "Scene cut sensitivity" }),
      dialog.getByRole("button", { name: "Split clips", exact: true }),
      dialog.getByRole("button", { name: "Normal", exact: true }),
   ];
   const before = await Promise.all(anchors.map((anchor) => anchor.boundingBox()));
   const expectStable = async () => expect(await Promise.all(anchors.map((anchor) => anchor.boundingBox()))).toEqual(before);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("scene-layout"))).toBe(true);
   await expect(dialog.getByRole("progressbar")).toBeVisible();
   await expectStable();
   await dialog.screenshot({ path: testInfo.outputPath("scene-cuts-scanning.png") });
   await app.evaluate(() => globalThis.attacutTestIpc.release("scene-layout"));
   await expect(dialog.getByText("3 found", { exact: true })).toBeVisible();
   await expectStable();
   await expect(ranges).toHaveCount(1);
   await dialog.screenshot({ path: testInfo.outputPath("scene-cuts.png") });
   await dialog.getByRole("checkbox").first().uncheck();
   await expect(dialog.getByText("2 selected", { exact: true })).toBeVisible();
   await expectStable();
   await expect(dialog.getByRole("button", { name: "Split clips", exact: true })).toBeEnabled();
   await dialog.getByRole("checkbox").first().check();
   await dialog.getByRole("button", { name: "Split clips", exact: true }).click();
   await expect(dialog).not.toBeVisible();
   await expect(ranges).toHaveCount(4);
   await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
   await expect(ranges).toHaveCount(1);
   await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
   await expect(ranges).toHaveCount(4);
   await ranges.last().click();
   await page.keyboard.press("Delete");
   await expect(ranges).toHaveCount(3);
});

test("changing sensitivity scans automatically and ignores replaced scan results", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, fixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await configureIpc(app, "source:scenes", { after: "scene-results" });
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const dialog = page.getByRole("dialog", { name: "Auto detect cuts" });
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("scene-results"))).toBe(true);
   await configureIpc(app, "source:scenes", { after: "replacement-results" });
   await dialog.getByRole("button", { name: "High", exact: true }).click();
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("replacement-results"))).toBe(true);
   await app.evaluate(() => globalThis.attacutTestIpc.release("scene-results"));
   await expect(dialog.getByRole("button", { name: "Split clips", exact: true })).toBeDisabled();
   await expect(dialog.getByRole("checkbox")).toHaveCount(0);
   await expect(dialog.getByRole("progressbar")).toBeVisible();
   await app.evaluate(() => globalThis.attacutTestIpc.release("replacement-results"));
   await expect(dialog.getByRole("checkbox")).toHaveCount(3);
   await expect(dialog.getByRole("button", { name: "Split clips", exact: true })).toBeEnabled();
   expect(await app.evaluate(() => globalThis.attacutTestIpc.count("source:scenes"))).toBe(2);
   await expect(dialog.locator(".segmented-control")).toHaveCSS("--segment-index", "2");
   await dialog.getByRole("button", { name: "Close panel" }).click();
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
});
test("cut results scroll without moving actions in a small light window", async ({ launchApp, profile }, testInfo) => {
   const app = await launchApp(profile, manyCutsFixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.setViewportSize({ width: 800, height: 480 });
   await page.emulateMedia({ reducedMotion: "reduce" });
   await page.keyboard.press("ControlOrMeta+,");
   await page.getByRole("button", { name: "Light theme", exact: true }).click();
   await page.getByRole("button", { name: "Close panel", exact: true }).click();
   await expect(page.getByRole("dialog")).not.toBeVisible();
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const dialog = page.getByRole("dialog", { name: "Auto detect cuts" });
   const split = dialog.getByRole("button", { name: "Split clips", exact: true });
   await dialog.evaluate(async (element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
   const before = await split.boundingBox();
   await dialog.getByRole("button", { name: "High", exact: true }).click();
   await expect(dialog.getByRole("button", { name: "High", exact: true })).toHaveAttribute("aria-pressed", "true");
   await expect(dialog.getByRole("checkbox")).toHaveCount(14);
   await expect(dialog.locator(".scene-cuts-content")).toHaveJSProperty("scrollTop", 0);
   await dialog.getByRole("checkbox").last().focus();
   await expect.poll(() => dialog.locator(".scene-cuts-content").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
   expect(await split.boundingBox()).toEqual(before);
   const dimensions = await dialog.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
   }));
   expect(dimensions.scrollHeight).toBe(dimensions.height);
   expect(dimensions.scrollWidth).toBe(dimensions.width);
   await dialog.screenshot({ path: testInfo.outputPath("scene-cuts-light-small.png") });
});

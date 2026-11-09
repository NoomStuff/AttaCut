import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { test, configureIpc, mediaBinary, waitForVideo } from "./app.mjs";

const fixture = resolve("work/scenes/ui-cuts.mp4");
const manyCutsFixture = resolve("work/scenes/ui-many-cuts.mp4");
const gapsFixture = resolve("work/scenes/ui-gaps.mp4");
const chaptersFile = resolve("work/scenes/ui-gaps-chapters.txt");
test.beforeAll(() => {
   mkdirSync(resolve("work/scenes"), { recursive: true });
   // Black until 0.52 and from 1.52 to 2.0, silence from 1.0 to 2.2, chapters at 1 and 2 seconds.
   writeFileSync(
      chaptersFile,
      [
         ";FFMETADATA1",
         ...["Intro", "Middle", "Outro"].flatMap((title, i) => [
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            `START=${i * 1000}`,
            `END=${i * 1000 + 1000}`,
            `title=${title}`,
         ]),
      ].join("\n")
   );
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
         "color=white:s=160x90:r=25:d=3,drawbox=color=black:t=fill:enable='lt(t,0.5)+between(t,1.5,1.99)'",
         "-f",
         "lavfi",
         "-i",
         "aevalsrc='0.5*sin(440*2*PI*t)*not(between(t,1,2.2))':s=48000:d=3",
         "-i",
         chaptersFile,
         "-map",
         "0:v",
         "-map",
         "1:a",
         "-map_chapters",
         "2",
         "-c:v",
         "libx264",
         "-g",
         "250",
         "-c:a",
         "aac",
         gapsFixture,
      ],
      { windowsHide: true }
   );
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
   await expect(dialog.getByRole("group", { name: "Scene cut sensitivity" })).toHaveCSS("--segment-index", "2");
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
   await expect(dialog.locator(".detection-content")).toHaveJSProperty("scrollTop", 0);
   await dialog.getByRole("checkbox").last().focus();
   await expect.poll(() => dialog.locator(".detection-content").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
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

const clipboard = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const copyCsv = async (page, app) => {
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Copy clip times as CSV" }).click();
   await expect(page.getByText(/^Copied \d+ clip times? as CSV\.$/)).toBeVisible();
   const [header, ...rows] = (await clipboard(app)).trim().split("\n");
   expect(header).toBe("start,end,duration");
   return rows.map((row) => row.split(",").map(Number));
};
const expectClips = (rows, expected) => {
   expect(rows).toHaveLength(expected.length);
   rows.forEach(([start, end, duration], i) => {
      expect(Math.abs(start - expected[i][0])).toBeLessThan(0.05);
      expect(Math.abs(end - expected[i][1])).toBeLessThan(0.05);
      expect(duration).toBeCloseTo(end - start, 3);
   });
};

test("silence and black frames remove parts of clips, with excluded ranges kept", async ({ launchApp, profile }, testInfo) => {
   const app = await launchApp(profile, gapsFixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   const ranges = page.locator(".clip-range:not(.exiting)");
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const dialog = page.getByRole("dialog", { name: "Auto detect cuts" });
   const modes = dialog.getByRole("group", { name: "Detect" });
   const remove = dialog.getByRole("button", { name: "Remove parts", exact: true });
   await modes.getByRole("button", { name: "Silence", exact: true }).click();
   await expect(dialog.getByText("1 found", { exact: true })).toBeVisible();
   await dialog.screenshot({ path: testInfo.outputPath("silence.png") });
   await remove.click();
   await expect(dialog).not.toBeVisible();
   await expect(ranges).toHaveCount(2);
   expectClips(await copyCsv(page, app), [
      [0, 1],
      [2.2, 3],
   ]);
   await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
   await expect(ranges).toHaveCount(1);

   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   await modes.getByRole("button", { name: "Black frames", exact: true }).click();
   await expect(dialog.getByText("1 found", { exact: true })).toBeVisible();
   await dialog.getByRole("button", { name: "0.1 s", exact: true }).click();
   await expect(dialog.getByText("2 found", { exact: true })).toBeVisible();
   await dialog.screenshot({ path: testInfo.outputPath("black-frames.png") });
   await dialog.getByRole("checkbox").last().uncheck();
   await expect(dialog.getByText("1 selected", { exact: true })).toBeVisible();
   // Switching away and back keeps the finished scan and the excluded range.
   await modes.getByRole("button", { name: "Scene cuts", exact: true }).click();
   await expect(dialog.getByRole("button", { name: "Split clips", exact: true })).toBeVisible();
   await modes.getByRole("button", { name: "Black frames", exact: true }).click();
   await expect(dialog.getByText("1 selected", { exact: true })).toBeVisible();
   await remove.click();
   await expect(ranges).toHaveCount(1);
   expectClips(await copyCsv(page, app), [[0.52, 3]]);

   // The first clip no longer starts at zero, so chapters follow the combined export.
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Copy clip times as YouTube chapters (combined export)" }).click();
   await expect(page.getByText("Copied 1 chapter timed for the combined export. YouTube needs at least 3, each 10 seconds or longer.")).toBeVisible();
   expect(await clipboard(app)).toBe("0:00 Clip 1\n");
});

test("chapters split clips and are offered only when the source has them", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, gapsFixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   const ranges = page.locator(".clip-range:not(.exiting)");
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const dialog = page.getByRole("dialog", { name: "Auto detect cuts" });
   await dialog.getByRole("group", { name: "Detect" }).getByRole("button", { name: "Chapters", exact: true }).click();
   await expect(dialog.getByText("2 found", { exact: true })).toBeVisible();
   await expect(dialog.getByRole("group", { name: "Chapter starts" })).toContainText("Middle");
   await expect(dialog.getByRole("group", { name: "Chapter starts" })).toContainText("Outro");
   await dialog.getByRole("button", { name: "Split clips", exact: true }).click();
   await expect(ranges).toHaveCount(3);
   expectClips(await copyCsv(page, app), [
      [0, 1],
      [1, 2],
      [2, 3],
   ]);
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Copy clip times as YouTube chapters", exact: true }).click();
   await expect(page.getByText("Copied 3 chapters. YouTube needs at least 3, each 10 seconds or longer.")).toBeVisible();
   expect(await clipboard(app)).toBe("0:00 Clip 1\n0:01 Clip 2\n0:02 Clip 3\n");
});

test("a video without audio or chapters explains the missing modes", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, fixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("button", { name: "Edit", exact: true }).click();
   await page.getByRole("menuitem", { name: "Auto detect cuts" }).click();
   const modes = page.getByRole("dialog", { name: "Auto detect cuts" }).getByRole("group", { name: "Detect" });
   await expect(modes.getByRole("button", { name: "Silence", exact: true })).toBeDisabled();
   await expect(modes.getByRole("button", { name: "Silence", exact: true })).toHaveAttribute("title", "This video has no audio.");
   await expect(modes.getByRole("button", { name: "Chapters", exact: true })).toHaveCount(0);
});

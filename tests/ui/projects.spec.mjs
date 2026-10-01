import { expect } from "@playwright/test";
import { test, waitForVideo, configureIpc } from "./app.mjs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

async function dialogs(app, path, response = 1) {
   await app.evaluate(
      ({ dialog }, { path, response }) => {
         dialog.showSaveDialog = async () => ({ canceled: !path, filePath: path });
         dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] });
         dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
      },
      { path, response }
   );
}
async function importFile(app, page, path) {
   await dialogs(app, path);
   await page.locator(".title-filename").click();
   await page.keyboard.press("ControlOrMeta+o");
}
async function trim(page, end = "00:08.50") {
   const field = page.getByRole("textbox", { name: "Clip end", exact: true });
   await field.fill(end);
   await field.press("Tab");
   await expect(page.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", String(Number(end.split(":").at(-1))));
   await page.locator(".title-filename").click();
}
async function savedProject(profile) {
   const source = join(profile, "source.mp4");
   await copyFile(resolve("work/fixture.mp4"), source);
   const info = await stat(source);
   const path = join(profile, "edit.attacut");
   const document = {
      format: "AttaCut",
      version: 1,
      relativeSource: "source.mp4",
      session: {
         path: source,
         size: info.size,
         modified: info.mtimeMs,
         clips: [{ id: "clip", start: 0, end: 8.5, color: 2 }],
         selectedId: "clip",
         past: [],
         future: [],
      },
   };
   await writeFile(path, JSON.stringify(document));
   return { path, source, document };
}

test("save, save as, cancel and import preserve clips and undo history", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const project = join(profile, "first.attacut");
   const second = join(profile, "second.attacut");
   await trim(page);
   await dialogs(app, project);
   await page.keyboard.press("ControlOrMeta+s");
   await expect(page.locator(".title-filename")).toHaveText("first.attacut");
   const first = JSON.parse(await readFile(project, "utf8"));
   expect(first.session.clips[0].end).toBe(8.5);
   expect(first.session.past).toHaveLength(1);
   expect(first.session.path).toBe(resolve("work/fixture.mp4"));
   expect(first.relativeSource).toBe(relative(profile, first.session.path).replaceAll("\\", "/"));
   await trim(page, "00:07.00");
   await expect(page.locator(".title-filename")).toHaveText("* first.attacut");
   await dialogs(app, null);
   await page.keyboard.press("ControlOrMeta+Shift+s");
   await page.getByRole("button", { name: "File", exact: true }).click();
   await expect(page.getByRole("menuitem", { name: "Close project", exact: true })).toBeEnabled();
   await page.keyboard.press("Escape");
   await expect(page.locator(".title-filename")).toHaveText("* first.attacut");
   await page.keyboard.press("ControlOrMeta+s");
   await expect(page.locator(".title-filename")).toHaveText("first.attacut");
   expect(JSON.parse(await readFile(project, "utf8")).session.clips[0].end).toBe(7);
   await dialogs(app, second);
   await page.keyboard.press("ControlOrMeta+Shift+s");
   await expect(page.locator(".title-filename")).toHaveText("second.attacut");
   await importFile(app, page, resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await importFile(app, page, second);
   await expect(page.locator(".title-filename")).toHaveText("second.attacut");
   await waitForVideo(page);
   await expect(page.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "7");
   await page.keyboard.press("ControlOrMeta+z");
   await expect(page.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "8.5");
   await page.keyboard.press("ControlOrMeta+Shift+z");
   await expect(page.locator(".title-filename")).toHaveText("second.attacut");
   await page.screenshot({ path: "test-results/project-editor.png" });
   await app.close();
   const restored = await launchApp(profile, "");
   const restoredPage = await restored.firstWindow();
   await expect(restoredPage.locator(".title-filename")).toHaveText("second.attacut");
   await expect(restoredPage.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "7");
   await restoredPage.keyboard.press("ControlOrMeta+z");
   await expect(restoredPage.locator(".title-filename")).toHaveText("* second.attacut");
   await dialogs(restored, null);
});

test("absolute fallback repairs the relative path, then moving both files repairs the absolute path", async ({ launchApp, profile }) => {
   const { path, source, document } = await savedProject(profile);
   const moved = join(profile, "moved");
   await mkdir(moved);
   const movedProject = join(moved, "edit.attacut");
   await rename(path, movedProject);
   const app = await launchApp(profile, movedProject);
   const page = await app.firstWindow();
   await expect(page.locator(".title-filename")).toHaveText("edit.attacut");
   await waitForVideo(page);
   let updated = JSON.parse(await readFile(movedProject, "utf8"));
   expect(updated.relativeSource).toBe("../source.mp4");
   expect(updated.session).toEqual(document.session);
   await app.close();
   const root = join(profile, "relocated");
   await mkdir(root);
   await rename(source, join(root, "source.mp4"));
   await rename(moved, join(root, "moved"));
   const relocatedProject = join(root, "moved", "edit.attacut");
   const reopened = await launchApp(profile, relocatedProject);
   const reopenedPage = await reopened.firstWindow();
   await expect(reopenedPage.locator(".title-filename")).toHaveText("edit.attacut");
   await waitForVideo(reopenedPage);
   updated = JSON.parse(await readFile(relocatedProject, "utf8"));
   expect(updated.session.path).toBe(join(root, "source.mp4"));
   expect(updated.relativeSource).toBe("../source.mp4");
   expect(updated.session.clips).toEqual(document.session.clips);
   expect(updated.session.past).toEqual(document.session.past);
});

test("missing media can be located, while changed media and malformed projects preserve the current edit", async ({ launchApp, profile }) => {
   const { path, source } = await savedProject(profile);
   const located = join(profile, "renamed.mp4");
   await rename(source, located);
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await dialogs(app, located, 0);
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
   await expect(page.locator(".title-filename")).toHaveText("edit.attacut");
   await waitForVideo(page);
   expect(JSON.parse(await readFile(path, "utf8")).session.path).toBe(located);
   await importFile(app, page, resolve("work/fixture.mp4"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   await writeFile(located, "changed video");
   const originalProject = await readFile(path);
   await dialogs(app, located, 0);
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
   await expect(page.getByRole("alert")).toContainText("original video has changed");
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   expect(await readFile(path)).toEqual(originalProject);
   const broken = join(profile, "broken.attacut");
   await writeFile(broken, "{");
   await importFile(app, page, broken);
   await expect(page.getByRole("alert")).toContainText("damaged or incomplete");
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
});

test("unsaved named projects can cancel import and native close or save before leaving", async ({ launchApp, profile }) => {
   const { path } = await savedProject(profile);
   const app = await launchApp(profile, path);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await trim(page, "00:06.00");
   await dialogs(app, resolve("work/fixture.mkv"), 2);
   await page.keyboard.press("ControlOrMeta+o");
   await expect(page.locator(".title-filename")).toHaveText("* edit.attacut");
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.ready("state:flush"))).toBe(true);
   expect(app.windows()).toHaveLength(1);
   expect(JSON.parse(await readFile(path, "utf8")).session.clips[0].end).toBe(8.5);
   await dialogs(app, resolve("work/fixture.mkv"), 0);
   await page.keyboard.press("ControlOrMeta+o");
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   expect(JSON.parse(await readFile(path, "utf8")).session.clips[0].end).toBe(6);
});

test("relative media wins over an old absolute path and dropped projects use the import flow", async ({ launchApp, profile }) => {
   const { source, document } = await savedProject(profile);
   const path = join(profile, "edit.atc");
   document.session.path = resolve("work/fixture.mkv");
   await writeFile(path, JSON.stringify(document));
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "project-drop";
      document.body.append(input);
   });
   await page.locator("#project-drop").setInputFiles(path);
   await page.evaluate(() => {
      const transfer = new globalThis.DataTransfer();
      transfer.items.add(document.querySelector("#project-drop").files[0]);
      document.querySelector(".app-shell").dispatchEvent(new globalThis.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      document.querySelector("#project-drop").remove();
   });
   await expect(page.locator(".title-filename")).toHaveText("edit.atc");
   await waitForVideo(page);
   expect(JSON.parse(await readFile(path, "utf8")).session.path).toBe(source);
   await expect(page.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "8.5");
});

test("native close waits for an in-flight project save and discards declined changes from recovery", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const path = join(profile, "pending.attacut");
   await trim(page);
   await dialogs(app, path);
   await configureIpc(app, "project:save", { before: "save-project" });
   await page.keyboard.press("ControlOrMeta+s");
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("save-project"))).toBe(true);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
   expect(app.windows()).toHaveLength(1);
   const exited = app.waitForEvent("close");
   await app.evaluate(() => globalThis.attacutTestIpc.release("save-project"));
   await exited;
   expect(JSON.parse(await readFile(path, "utf8")).session.clips[0].end).toBe(8.5);
   const restored = await launchApp(profile, "");
   const restoredPage = await restored.firstWindow();
   await expect(restoredPage.locator(".title-filename")).toHaveText("pending.attacut");
   await waitForVideo(restoredPage);
   await trim(restoredPage, "00:06.00");
   await dialogs(restored, null, 1);
   await restored.close();
   const reopened = await launchApp(profile, "");
   const reopenedPage = await reopened.firstWindow();
   await expect(reopenedPage.locator(".title-filename")).toHaveText("pending.attacut");
   await expect(reopenedPage.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "8.5");
});

test("a superseded project import cannot replace a newer source or reopen a closed workspace", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   const { path } = await savedProject(profile);
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   await configureIpc(app, "project:open", { before: "old-project" });
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("old-project"))).toBe(true);
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
   await app.evaluate(() => globalThis.attacutTestIpc.release("old-project"));
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.count("project:open"))).toBe(1);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
   await configureIpc(app, "project:open", { before: "closed-project" });
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("closed-project"))).toBe(true);
   await page.getByRole("button", { name: "File", exact: true }).click();
   await page.getByRole("menuitem", { name: "Close project", exact: true }).click();
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible();
   await app.evaluate(() => globalThis.attacutTestIpc.release("closed-project"));
   await expect(page.locator("video")).toHaveCount(0);
});

test("closing a project saves or discards without a second prompt on quit", async ({ launchApp, profile }) => {
   const { path } = await savedProject(profile);
   const app = await launchApp(profile, path);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await trim(page, "00:06.00");
   await dialogs(app, null, 0);
   await page.getByRole("button", { name: "File", exact: true }).click();
   await page.getByRole("menuitem", { name: "Close project", exact: true }).click();
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible();
   expect(JSON.parse(await readFile(path, "utf8")).session.clips[0].end).toBe(6);
   await dialogs(app, null, 2);
   await app.close();
   const restored = await launchApp(profile, "");
   const restoredPage = await restored.firstWindow();
   await expect(restoredPage.locator(".title-filename")).toHaveText("edit.attacut");
   await waitForVideo(restoredPage);
   await trim(restoredPage, "00:04.00");
   await dialogs(restored, null, 1);
   await restoredPage.getByRole("button", { name: "File", exact: true }).click();
   await restoredPage.getByRole("menuitem", { name: "Close project", exact: true }).click();
   await expect(restoredPage.getByRole("button", { name: "Open file", exact: true })).toBeVisible();
   await dialogs(restored, null, 2);
   await restored.close();
   const reopened = await launchApp(profile, "");
   const reopenedPage = await reopened.firstWindow();
   await expect(reopenedPage.locator(".title-filename")).toHaveText("edit.attacut");
   await expect(reopenedPage.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "6");
});

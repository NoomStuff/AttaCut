import { hasDisposableDesktop } from "./test-isolation";
import { runDesktopTests } from "./desktop-tests";
import { execFileSync } from "node:child_process";
if (!hasDisposableDesktop()) {
   await runDesktopTests("native");
   process.exit(0);
}

for (const args of [["tests/create-fixtures.ts"], ["run", "build"], ["x", "--no-install", "playwright", "test", "--project=native"]]) {
   execFileSync(process.execPath, args, { stdio: "inherit", windowsHide: true, env: { ...process.env, ATTACUT_NATIVE_SMOKE: "1" } });
}

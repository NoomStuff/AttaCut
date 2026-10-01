import { execFileSync } from "node:child_process";
for (const args of [["tests/create-fixtures.ts"], ["run", "build"], ["x", "--no-install", "playwright", "test", "--project=native"]]) {
   execFileSync(process.execPath, args, { stdio: "inherit", windowsHide: true, env: { ...process.env, ATTACUT_NATIVE_SMOKE: "1" } });
}

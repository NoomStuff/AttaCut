import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * One long-lived PowerShell for the few Windows file operations Node cannot do. A cold
 * PowerShell takes seconds to start, so exports warm it while planning and reuse it.
 * Requests are one line each: a verb, then base64 UTF-8 arguments, so any path survives
 * the console encoding.
 */
const script = String.raw`
$ErrorActionPreference = 'Stop'
function Arg($value) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) }
function Trashable($path, [long]$size) {
   $root = [IO.Path]::GetPathRoot($path)
   $drive = [IO.DriveInfo]::new($root)
   if ($drive.DriveType -ne 'Fixed') { return 'no:' + $drive.DriveType }
   $volume = [regex]::Match((& mountvol $root /L | Out-String), '\{[^}]+\}').Value
   $max = [long]($drive.TotalSize * 0.05 / 1MB)
   $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\$volume"
   if ($volume -and (Test-Path $key)) {
      $settings = Get-ItemProperty $key
      if ([int]$settings.NukeOnDelete -eq 1) { return 'no:Off' }
      if ($settings.MaxCapacity) { $max = [long]$settings.MaxCapacity }
   }
   if ($size -gt $max * 1MB) { return 'no:Size' }
   return 'yes'
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
   $parts = $line.Split([char]9)
   try {
      switch ($parts[0]) {
         'created' { [IO.File]::SetCreationTimeUtc((Arg $parts[1]), [DateTime]::new([long]$parts[2], 'Utc')); $reply = 'ok' }
         'trashable' { $reply = Trashable (Arg $parts[1]) ([long]$parts[2]) }
         'format' { $reply = 'ok:' + ([IO.DriveInfo]::new([IO.Path]::GetPathRoot((Arg $parts[1])))).DriveFormat }
         default { $reply = 'error:unknown request' }
      }
   } catch { $reply = 'error:' + ($_.Exception.Message -replace '[\r\n]+', ' ') }
   [Console]::Out.WriteLine($reply)
   [Console]::Out.Flush()
}
`;

export type TrashSupport = "yes" | "removable" | "network" | "off" | "size" | "other";

class WindowsShell {
   private child: ChildProcessWithoutNullStreams | null = null;
   private waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
   private idle: ReturnType<typeof setTimeout> | null = null;

   warm(): void {
      if (process.platform === "win32") this.process();
   }

   async setCreated(path: string, created: number): Promise<void> {
      const ticks = BigInt(Math.round(created * 10_000)) + 621_355_968_000_000_000n;
      const reply = await this.request("created", encode(path), String(ticks));
      if (reply !== "ok") throw new Error(reply.replace(/^error:/, ""));
   }

   async trashSupport(path: string, size: number): Promise<TrashSupport> {
      const reply = await this.request("trashable", encode(path), String(Math.ceil(size)));
      if (reply === "yes") return "yes";
      const reason = /^no:(\w+)/.exec(reply)?.[1]?.toLowerCase();
      if (reason === "removable" || reason === "network" || reason === "off" || reason === "size") return reason;
      if (reason) return "other";
      throw new Error(reply.replace(/^error:/, ""));
   }

   /** The drive's filesystem name, such as NTFS, exFAT or FAT32. */
   async driveFormat(path: string): Promise<string> {
      const reply = await this.request("format", encode(path));
      if (!reply.startsWith("ok:")) throw new Error(reply.replace(/^error:/, ""));
      return reply.slice(3);
   }

   dispose(): void {
      this.child?.kill();
      this.child = null;
   }

   private request(...fields: string[]): Promise<string> {
      const child = this.process();
      let timer: ReturnType<typeof setTimeout> | undefined;
      return new Promise<string>((resolve, reject) => {
         this.waiting.push({ resolve, reject });
         hold(child, true);
         // A hung helper must not leave an export saving forever; the exit handler rejects every waiter.
         timer = setTimeout(() => child.kill(), 15_000);
         child.stdin.write(`${fields.join("\t")}\n`);
      }).finally(() => {
         clearTimeout(timer);
         if (!this.waiting.length) hold(child, false);
      });
   }

   private process(): ChildProcessWithoutNullStreams {
      if (this.idle) clearTimeout(this.idle);
      this.idle = setTimeout(() => this.dispose(), 120_000);
      this.idle.unref();
      if (this.child) return this.child;
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
         windowsHide: true,
         stdio: "pipe",
      });
      child.unref();
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => this.waiting.shift()?.resolve(line.trim()));
      const fail = (error: Error) => {
         if (this.child === child) this.child = null;
         for (const waiter of this.waiting.splice(0)) waiter.reject(error);
      };
      child.on("error", fail);
      child.on("exit", () => fail(new Error("PowerShell stopped.")));
      child.stdin.on("error", () => undefined);
      child.stderr.resume();
      hold(child, false);
      this.child = child;
      return child;
   }
}

/** An idle helper must not keep a plain Node process alive; a pending request must. */
function hold(child: ChildProcessWithoutNullStreams, active: boolean): void {
   for (const stream of [child.stdin, child.stdout, child.stderr] as unknown as { ref?: () => void; unref?: () => void }[])
      if (active) stream.ref?.();
      else stream.unref?.();
}

function encode(value: string): string {
   return Buffer.from(value, "utf8").toString("base64");
}

export const windowsShell = new WindowsShell();

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Session variables that would let Electron, audio or D-Bus reach the real desktop.
const desktopVariables = [
   "DISPLAY",
   "WAYLAND_DISPLAY",
   "WAYLAND_SOCKET",
   "XAUTHORITY",
   "XDG_SESSION_TYPE",
   "XDG_CURRENT_DESKTOP",
   "XDG_SESSION_DESKTOP",
   "DESKTOP_SESSION",
   "HYPRLAND_INSTANCE_SIGNATURE",
   "SWAYSOCK",
   "DBUS_SESSION_BUS_ADDRESS",
   "PULSE_SERVER",
   "PULSE_SINK",
   "PIPEWIRE_REMOTE",
   "SSH_AUTH_SOCK",
   "GNOME_KEYRING_CONTROL",
];

// Hardware monitors stay off, so the private session manager never opens real sound cards or cameras.
const wireplumberConfig = `wireplumber.profiles = {
   main = {
      monitor.alsa = disabled
      monitor.alsa-midi = disabled
      monitor.bluez = disabled
      monitor.bluez.seat-monitoring = disabled
      monitor.v4l2 = disabled
      monitor.libcamera = disabled
   }
}
`;

// A session bus with no service directories, so nothing auto-starts portals, gvfs or keyrings.
const dbusConfig = (dir: string): string => `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
   <type>session</type>
   <listen>unix:dir=${dir}</listen>
   <auth>EXTERNAL</auth>
   <policy context="default">
      <allow send_destination="*" eavesdrop="true"/>
      <allow eavesdrop="true"/>
      <allow own="*"/>
   </policy>
</busconfig>
`;

// Mirrors the Linux job in desktop-tests.yml: Xvfb, Openbox, a private D-Bus and a null audio sink.
const launcher = String.raw`
set -euo pipefail
dir="$ATTACUT_PRIVATE_DESKTOP"
openbox --sm-disable > "$dir/openbox.log" 2>&1 &
for _ in $(seq 100); do
   xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id #" && break
   sleep 0.1
done
xprop -root _NET_SUPPORTING_WM_CHECK | grep -q "window id #"
if command -v pipewire > /dev/null && command -v wireplumber > /dev/null && command -v pipewire-pulse > /dev/null; then
   pipewire > "$dir/pipewire.log" 2>&1 &
   sleep 0.3
   wireplumber > "$dir/wireplumber.log" 2>&1 &
   pipewire-pulse > "$dir/pipewire-pulse.log" 2>&1 &
elif command -v pulseaudio > /dev/null; then
   mkdir -p "$dir/pulse"
   pulseaudio -n --daemonize=yes --use-pid-file=no --exit-idle-time=-1 --log-target="file:$dir/pulseaudio.log" --load="module-native-protocol-unix socket=$dir/pulse/native auth-anonymous=1"
else
   echo "Install pipewire, pipewire-pulse and wireplumber, or pulseaudio, for the private audio server." >&2
   exit 1
fi
export PULSE_SERVER="unix:$dir/pulse/native"
export PULSE_SINK=attacut_test
for _ in $(seq 100); do pactl info > /dev/null 2>&1 && break; sleep 0.1; done
pactl load-module module-null-sink sink_name=attacut_test rate=48000 channels=2 > /dev/null
pactl set-default-sink attacut_test
sinks="$(pactl list short sinks | cut -f2)"
if [ "$sinks" != attacut_test ]; then
   echo "The private audio server exposed unexpected sinks: $sinks" >&2
   exit 1
fi
printf '%s' "$DISPLAY" > "$dir/display"
status=0
"$@" || status=$?
jobs -p | xargs -r kill 2> /dev/null || true
exit "$status"
`;

const missingTools = (): string[] =>
   ["xvfb-run", "openbox", "xprop", "dbus-run-session", "pactl"].filter((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status !== 0);

// Runs a command on a private X display, audio server and D-Bus session. Linux only.
export function runOnPrivateDesktop(command: string[], extraEnv: NodeJS.ProcessEnv = {}): number {
   if (process.platform !== "linux") {
      throw new Error("A private local desktop needs Linux with Xvfb. Use the remote commands in TESTING.md on this OS.");
   }
   const missing = missingTools();
   if (missing.length) throw new Error(`Install ${missing.join(", ")} to run desktop tests on a private display.`);

   // Unix socket paths are limited to 108 bytes, so keep the runtime directory short.
   const dir = mkdtempSync(join(tmpdir(), "attacut-desktop-"));
   chmodSync(dir, 0o700);
   mkdirSync(join(dir, "config", "wireplumber", "wireplumber.conf.d"), { recursive: true });
   writeFileSync(join(dir, "config", "wireplumber", "wireplumber.conf.d", "attacut.conf"), wireplumberConfig);
   writeFileSync(join(dir, "dbus.conf"), dbusConfig(dir));

   const env: NodeJS.ProcessEnv = { ...process.env };
   for (const name of desktopVariables) delete env[name];
   Object.assign(env, extraEnv, {
      ATTACUT_PRIVATE_DESKTOP: dir,
      XDG_RUNTIME_DIR: dir,
      PIPEWIRE_RUNTIME_DIR: dir,
      XDG_CONFIG_HOME: join(dir, "config"),
      ELECTRON_OZONE_PLATFORM_HINT: "x11",
      GIO_USE_VFS: "local",
      GTK_USE_PORTAL: "0",
      NO_AT_BRIDGE: "1",
   });
   try {
      const result = spawnSync(
         "xvfb-run",
         [
            "--auto-servernum",
            "--server-args=-screen 0 1920x1080x24 -nolisten tcp",
            "dbus-run-session",
            `--config-file=${join(dir, "dbus.conf")}`,
            "--",
            "bash",
            "-c",
            launcher,
            "attacut-desktop",
            ...command,
         ],
         { stdio: "inherit", env }
      );
      if (result.error) throw result.error;
      return result.status ?? 1;
   } finally {
      rmSync(dir, { recursive: true, force: true });
   }
}

if (import.meta.main) {
   const command = process.argv.slice(2);
   if (!command.length) throw new Error("Usage: bun scripts/private-desktop.ts <command> [args...]");
   process.exit(runOnPrivateDesktop(command));
}

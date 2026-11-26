// Native splash for AcroClip, AttaCut and Deduup. This file is shared line for line;
// identity.cs beside it holds the app's name, colours and runtime executable. Both are
// compiled with the .NET Framework csc.exe that ships with Windows, so they must stay
// C# 5 compatible.
//
// The packaged product executable is this launcher. It shows the splash at once, starts
// the Electron runtime beside it and closes when the app reports its own window ready.
//
// Usage:
//   <App>.exe [app arguments]                 Launcher: show the splash, start <App>-app.exe.
//                                             After an update (--updated) it shows a near-full bar.
//   <App>.exe --update <iconPath> [<runtimePid> <runtimePath> [<installerPath>]]
//                                             Update: a progress bar while an update installs,
//                                             from a temporary copy. Closes when the updated
//                                             app's launcher or window shows, or the installer
//                                             is long gone without either.
//   <App>.exe <iconPath> <signalPath>         Wait: show until the signal file exists.
//
// Every mode starts above other windows, then drops to the top of the normal ones so the
// user can bring another window over it.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle(Identity.Name)]
[assembly: AssemblyDescription(Identity.Name)]
[assembly: AssemblyProduct(Identity.Name)]
[assembly: AssemblyCompany("NoomStuff")]

internal sealed class Splash : Form
{
    private const int LayoutMargin = 22;
    private const int LogoSize = 64;
    private const int SpinSize = 22;
    private const int Radius = 16;
    private const int BarWidth = 120;
    private const int BarHeight = 4;
    private const float AfterUpdateStart = 0.9f;
    private const int LifetimeMs = 120000;

    private readonly float scale;
    private readonly Bitmap logo;
    private readonly string signalPath;
    private readonly string handoverPath;
    private readonly Process child;
    private readonly string launchExe;
    private readonly bool isLauncher;
    private readonly Timer spinTimer;
    private readonly Timer doneTimer;
    private readonly Timer lifetime;
    private readonly Timer watchTimer;
    private readonly UpdateWatch watch;
    private readonly bool afterUpdate;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private float angle;
    private float progress;
    private int childExitCode;

    internal Splash(string iconPath, string signalPath, string handoverPath, string childArguments, string launchExe, UpdateWatch watch, bool afterUpdate)
    {
        this.signalPath = signalPath;
        this.handoverPath = handoverPath;
        this.watch = watch;
        this.afterUpdate = afterUpdate;
        if (afterUpdate) progress = AfterUpdateStart;
        using (Graphics measure = CreateGraphics()) scale = measure.DpiX / 96f;

        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Identity.Background;
        Size = new Size(Scaled(216), Scaled(148));
        // The portable stub's extraction window centers on the screen bounds; matching it
        // exactly makes the handover from static image to animated splash seamless.
        Rectangle area = Screen.PrimaryScreen.Bounds;
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);

        if (iconPath != null && File.Exists(iconPath))
        {
            using (Bitmap source = new Bitmap(iconPath))
            {
                logo = new Bitmap(source, Scaled(LogoSize), Scaled(LogoSize));
            }
        }

        // An app that was launched directly bounds the splash by its own lifetime; a
        // launcher whose app could not be started closes at once instead of hanging.
        if (launchExe != null)
        {
            isLauncher = true;
            this.launchExe = launchExe;
            child = Launch(launchExe, signalPath, childArguments);
            if (child == null) childExitCode = 1;
        }

        lifetime = new Timer();
        lifetime.Interval = LifetimeMs;
        lifetime.Tick += delegate { Close(); };
        if (child == null) lifetime.Start(); // Only for the orphan-prone wait and update modes.

        doneTimer = new Timer();
        doneTimer.Interval = 40;
        doneTimer.Tick += delegate
        {
            bool signalled = signalPath != null && File.Exists(signalPath);
            bool exited = child != null && child.HasExited;
            // Launcher mode also closes when the app spawn failed outright (child == null),
            // so a broken install fails fast instead of showing a splash forever.
            if (!signalled && !exited && (child != null || !isLauncher)) return;
            if (exited) childExitCode = child.ExitCode;
            // A runtime that exits cleanly before its window is ready handed the arguments to
            // the instance already running. Explorer gave this launcher the right to take the
            // foreground, and by the time the request reaches the running window Windows can
            // refuse it there and only flash its taskbar button. So the launcher raises it.
            if (exited && !signalled && childExitCode == 0) Foreground.RaiseRunning(launchExe, child.Id);
            if (watch != null) watch.Finish(true);
            Close();
        };
        doneTimer.Start();

        // The handover alone can miss, and the update splash must never outstay the app.
        watchTimer = new Timer();
        watchTimer.Interval = 250;
        watchTimer.Tick += delegate
        {
            watch.Poll();
            if (!watch.AppShown && !watch.GaveUp) return;
            watch.Finish(watch.AppShown);
            Close();
        };
        if (watch != null) watchTimer.Start();

        spinTimer = new Timer();
        spinTimer.Interval = 30;
        spinTimer.Tick += delegate
        {
            angle = (angle + 6f) % 360f;
            if (watch != null || afterUpdate)
            {
                float target = watch != null ? watch.Progress : AfterUpdateStart + 0.08f * UpdateWatch.Ease(clock.ElapsedMilliseconds / 3000f);
                if (target > progress) progress += (target - progress) * 0.18f;
            }
            // Repaint the whole window: the arc stroke overhangs the spin rect, and a
            // rect-limited invalidate leaves trails of every previous frame behind.
            Invalidate();
        };
        spinTimer.Start();
    }

    // The launcher draws over an update splash at the same spot, then tells it to go.
    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Layering.DropBelowTopmost(Handle);
        if (handoverPath == null) return;
        try
        {
            File.WriteAllText(handoverPath, "1");
        }
        catch
        {
            // Without the handover the update splash still times out.
        }
    }

    internal static Process Launch(string appExe, string signalPath, string childArguments)
    {
        NativeLaunch.ProcessInformation created = new NativeLaunch.ProcessInformation();
        bool resumed = false;
        string previousSignal = Environment.GetEnvironmentVariable(Identity.SignalVariable);
        try
        {
            string full = Path.GetFullPath(appExe);
            NativeLaunch.StartupInfo startup = new NativeLaunch.StartupInfo();
            startup.Size = Marshal.SizeOf(typeof(NativeLaunch.StartupInfo));
            Environment.SetEnvironmentVariable(Identity.SignalVariable, signalPath ?? "");
            // Explorer gives this launcher foreground permission. Transfer it before
            // Electron runs, including before its single-instance notification grants
            // that permission to an already-running instance.
            StringBuilder command = new StringBuilder("\"" + full + "\" " + (childArguments ?? ""));
            if (!NativeLaunch.CreateProcess(full, command, IntPtr.Zero, IntPtr.Zero, false,
                NativeLaunch.CreateSuspended, IntPtr.Zero, Path.GetDirectoryName(full), ref startup, out created)) return null;
            NativeLaunch.AllowSetForegroundWindow(created.ProcessId);
            Process process = Process.GetProcessById((int)created.ProcessId);
            // Retain a managed handle before a second instance can exit. The splash
            // still needs to read its exit code after the native handles close.
            IntPtr retainedHandle = process.Handle;
            if (NativeLaunch.ResumeThread(created.Thread) == UInt32.MaxValue)
            {
                process.Dispose();
                return null;
            }
            resumed = true;
            return process;
        }
        catch
        {
            return null;
        }
        finally
        {
            Environment.SetEnvironmentVariable(Identity.SignalVariable, previousSignal);
            if (created.Thread != IntPtr.Zero)
            {
                // A failed resume must not leave a suspended runtime behind.
                if (!resumed) NativeLaunch.TerminateProcess(created.Process, 1);
                NativeLaunch.CloseHandle(created.Thread);
            }
            if (created.Process != IntPtr.Zero) NativeLaunch.CloseHandle(created.Process);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            // The launcher's STA wait for the app pumps messages, so live timers would tick all session.
            if (spinTimer != null) spinTimer.Dispose();
            if (doneTimer != null) doneTimer.Dispose();
            if (lifetime != null) lifetime.Dispose();
            if (watchTimer != null) watchTimer.Dispose();
            if (watch != null) watch.Dispose();
            if (logo != null) logo.Dispose();
        }
        base.Dispose(disposing);
    }

    private int Scaled(int value)
    {
        return (int)Math.Round(value * scale);
    }

    private Rectangle SpinBounds()
    {
        int side = Scaled(SpinSize);
        return new Rectangle((Width - side) / 2, Scaled(LayoutMargin + LogoSize + LayoutMargin), side, side);
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE, so focus stays where it was.
            return parameters;
        }
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        using (GraphicsPath path = RoundedPath(new Rectangle(Point.Empty, Size), Scaled(Radius)))
        {
            Region = new Region(path);
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (GraphicsPath frame = RoundedPath(new Rectangle(Point.Empty, Size), Scaled(Radius)))
        using (Pen border = new Pen(Identity.Border))
        {
            graphics.DrawPath(border, frame);
        }
        if (logo != null)
        {
            graphics.DrawImage(logo, (Width - logo.Width) / 2, Scaled(LayoutMargin), logo.Width, logo.Height);
        }
        if (watch != null || afterUpdate)
        {
            PaintProgress(graphics);
            return;
        }
        Rectangle spin = SpinBounds();
        using (Pen track = new Pen(Color.FromArgb(28, 255, 255, 255), 3f * scale))
        {
            graphics.DrawArc(track, spin, 0f, 360f);
        }
        using (Pen arc = new Pen(Identity.Accent, 3f * scale))
        {
            arc.StartCap = LineCap.Round;
            arc.EndCap = LineCap.Round;
            graphics.DrawArc(arc, spin, angle, 130f);
        }
    }

    private void PaintProgress(Graphics graphics)
    {
        int width = Scaled(BarWidth);
        int height = Math.Max(2, Scaled(BarHeight));
        Rectangle spin = SpinBounds();
        Rectangle track = new Rectangle((Width - width) / 2, spin.Top + (spin.Height - height) / 2, width, height);
        using (GraphicsPath path = RoundedPath(track, height / 2))
        using (Brush brush = new SolidBrush(Color.FromArgb(28, 255, 255, 255)))
        {
            graphics.FillPath(brush, path);
        }
        int filled = (int)Math.Round(width * Math.Min(1f, progress));
        if (filled < height) return;
        using (GraphicsPath path = RoundedPath(new Rectangle(track.X, track.Y, filled, height), height / 2))
        using (Brush brush = new SolidBrush(Identity.Accent))
        {
            graphics.FillPath(brush, path);
        }
    }

    private static GraphicsPath RoundedPath(Rectangle bounds, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180f, 90f);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270f, 90f);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0f, 90f);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90f, 90f);
        path.CloseFigure();
        return path;
    }

    public int ChildExitCode
    {
        get { return childExitCode; }
    }

    public Process Child
    {
        get { return child; }
    }
}

// Watches an update from the outside: the old runtime quitting, the installer running and
// the updated runtime's window. The install time is estimated from the previous update.
internal sealed class UpdateWatch : IDisposable
{
    private const int DefaultInstallMs = 12000;
    private const int GraceMs = 20000;

    private readonly Process runtime;
    private readonly int runtimeId;
    private readonly string runtimePath;
    private readonly string installerName;
    private readonly string estimatePath;
    private readonly int expectedInstallMs;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private long quitAt = -1;
    private long installedAt = -1;
    private bool installerSeen;
    private bool appShown;
    private bool gaveUp;

    private UpdateWatch(int runtimeId, string runtimePath, string installerPath, string estimatePath)
    {
        this.runtimeId = runtimeId;
        this.runtimePath = runtimePath;
        this.estimatePath = estimatePath;
        if (installerPath != null) installerName = Path.GetFileNameWithoutExtension(installerPath);
        try
        {
            if (runtimeId > 0) runtime = Process.GetProcessById(runtimeId);
        }
        catch
        {
            // Already gone: the install phase starts now.
        }
        expectedInstallMs = DefaultInstallMs;
        try
        {
            int saved;
            if (File.Exists(estimatePath) && Int32.TryParse(File.ReadAllText(estimatePath).Trim(), out saved))
                expectedInstallMs = Math.Max(2000, Math.Min(60000, saved));
        }
        catch
        {
            // Without an estimate the bar paces itself on the default.
        }
    }

    internal static UpdateWatch From(string[] args)
    {
        int id;
        string estimate = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "install-ms");
        if (args.Length < 4 || !Int32.TryParse(args[2], out id)) return new UpdateWatch(-1, null, null, estimate);
        return new UpdateWatch(id, args[3], args.Length > 4 ? args[4] : null, estimate);
    }

    internal static float Ease(float x)
    {
        return 1f - (float)Math.Exp(-x);
    }

    internal bool AppShown
    {
        get { return appShown; }
    }

    internal bool GaveUp
    {
        get { return gaveUp; }
    }

    internal void Poll()
    {
        long now = clock.ElapsedMilliseconds;
        if (quitAt < 0 && (runtime == null || runtime.HasExited)) quitAt = now;
        if (quitAt < 0) return;
        if (installerName != null && installedAt < 0)
        {
            bool installing = IsRunning(installerName);
            if (installing) installerSeen = true;
            else if (installerSeen) installedAt = now;
        }
        if (runtimePath != null && RuntimeWindowShown()) appShown = true;
        if (installedAt >= 0 && now - installedAt > GraceMs) gaveUp = true;
    }

    // Real signals anchor the bar: the old app quitting and the installer finishing. Only
    // the stretch between them is paced on the estimate, slowing down once it runs over.
    internal float Progress
    {
        get
        {
            long now = clock.ElapsedMilliseconds;
            if (quitAt < 0) return 0.08f * Ease(now / 1500f);
            long end = installedAt >= 0 ? installedAt : now;
            float done = (end - quitAt) / (float)expectedInstallMs;
            float value = done <= 1f ? 0.08f + 0.8f * done : 0.88f + 0.06f * Ease(done - 1f);
            if (installedAt >= 0) value = Math.Max(value, 0.92f + 0.06f * Ease((now - installedAt) / 2000f));
            return value;
        }
    }

    internal void Finish(bool reachedApp)
    {
        if (!reachedApp || quitAt < 0) return;
        long took = (installedAt >= 0 ? installedAt : clock.ElapsedMilliseconds) - quitAt;
        if (took < 1000 || took > 60000) return;
        try
        {
            File.WriteAllText(estimatePath, took.ToString());
        }
        catch
        {
            // The next update keeps the previous or default estimate.
        }
    }

    private static bool IsRunning(string name)
    {
        Process[] found = Process.GetProcessesByName(name);
        foreach (Process process in found) process.Dispose();
        return found.Length > 0;
    }

    private bool RuntimeWindowShown()
    {
        bool shown = false;
        foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(runtimePath)))
        {
            using (process)
            {
                try
                {
                    if (shown || process.Id == runtimeId || process.MainWindowHandle == IntPtr.Zero) continue;
                    shown = String.Equals(process.MainModule.FileName, runtimePath, StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    // Processes that exit or deny access while listed are not the updated app.
                }
            }
        }
        return shown;
    }

    public void Dispose()
    {
        if (runtime != null) runtime.Dispose();
    }
}

internal static class Layering
{
    private static readonly IntPtr NotTopmost = new IntPtr(-2);
    private const uint NoSize = 0x0001;
    private const uint NoMove = 0x0002;
    private const uint NoActivate = 0x0010;

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    // Form.TopMost = false would also activate the window and take focus from the user.
    internal static void DropBelowTopmost(IntPtr window)
    {
        SetWindowPos(window, NotTopmost, 0, 0, 0, 0, NoSize | NoMove | NoActivate);
    }
}

internal static class Foreground
{
    private const int Restore = 9;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint thread, uint otherThread, bool attach);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    // Raises the window of the runtime that is already running from the same install, never
    // one from another install or the runtime that just handed off.
    internal static void RaiseRunning(string runtimeExe, int handedOffFrom)
    {
        IntPtr window = IntPtr.Zero;
        try
        {
            string path = Path.GetFullPath(runtimeExe);
            foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(path)))
            {
                using (process)
                {
                    try
                    {
                        if (window != IntPtr.Zero || process.Id == handedOffFrom || process.MainWindowHandle == IntPtr.Zero) continue;
                        if (!String.Equals(process.MainModule.FileName, path, StringComparison.OrdinalIgnoreCase)) continue;
                        window = process.MainWindowHandle;
                    }
                    catch
                    {
                        // Processes that exit or deny access while listed are not candidates.
                    }
                }
            }
        }
        catch
        {
            return;
        }
        if (window == IntPtr.Zero) return;
        if (IsIconic(window)) ShowWindow(window, Restore);
        if (SetForegroundWindow(window)) return;
        // Joining the foreground thread's input queue lets the activation through when the
        // grant from Explorer has already lapsed. The queues are separated straight after.
        uint ignored;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint thread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != thread && AttachThreadInput(thread, foregroundThread, true);
        try
        {
            BringWindowToTop(window);
            SetForegroundWindow(window);
        }
        finally
        {
            if (attached) AttachThreadInput(thread, foregroundThread, false);
        }
    }
}

internal static class NativeLaunch
{
    internal const uint CreateSuspended = 0x00000004;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct StartupInfo
    {
        internal int Size;
        internal string Reserved, Desktop, Title;
        internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        internal ushort ShowWindow, ReservedSize;
        internal IntPtr ReservedBytes, StandardInput, StandardOutput, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ProcessInformation
    {
        internal IntPtr Process, Thread;
        internal uint ProcessId, ThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInformation process);

    [DllImport("user32.dll")]
    internal static extern bool AllowSetForegroundWindow(uint processId);

    [DllImport("kernel32.dll")]
    internal static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll")]
    internal static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll")]
    internal static extern bool CloseHandle(IntPtr handle);
}

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    // Launcher mode is picked when the sibling runtime exists: the splash shows at once,
    // the app starts with a fresh signal path in its environment, every command-line
    // argument is forwarded untouched, and the process waits for the app so packaging
    // wrappers that ExecWait this launcher see its real exit code.
    [STAThread]
    private static int Main(string[] args)
    {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string selfDir = Path.GetDirectoryName(Application.ExecutablePath);
        string appExe = Path.Combine(selfDir, Identity.RuntimeExe);
        // One fixed path per app: an update splash waits for it, the next launcher writes it.
        string handover = Path.Combine(Path.GetTempPath(), Identity.Slug + "-update-splash.signal");

        string icon;
        string signal;
        string launch = null;
        string handoverToWrite = null;
        UpdateWatch watch = null;
        if (args.Length >= 2 && args[0] == "--update")
        {
            icon = args[1];
            signal = handover;
            watch = UpdateWatch.From(args);
            try
            {
                if (File.Exists(handover)) File.Delete(handover);
            }
            catch
            {
                // A stale handover only shortens this splash.
            }
        }
        else if (File.Exists(appExe))
        {
            // Command invocations, like saving a clip from a hotkey tool, start without a splash.
            if (Array.Exists(args, delegate(string argument) { return Array.IndexOf(Identity.QuietArguments, argument) >= 0; }))
            {
                Process quiet = Splash.Launch(appExe, null, JoinQuoted(args));
                if (quiet == null) return 1;
                quiet.WaitForExit();
                return quiet.ExitCode;
            }
            icon = Path.Combine(selfDir, "resources", "icons", "icon.png");
            signal = Path.Combine(Path.GetTempPath(), Identity.Slug + "-splash-" + Guid.NewGuid().ToString("N") + ".signal");
            launch = appExe;
            handoverToWrite = handover;
        }
        else
        {
            icon = args.Length > 0 ? args[0] : null;
            signal = args.Length > 1 ? args[1] : null;
        }

        bool afterUpdate = launch != null && Array.IndexOf(args, "--updated") >= 0;
        Splash splash = new Splash(icon, signal, handoverToWrite, launch != null ? JoinQuoted(args) : null, launch, watch, afterUpdate);
        Application.Run(splash);
        int exitCode = splash.ChildExitCode;
        if (launch != null && splash.Child != null && !splash.Child.HasExited)
        {
            splash.Child.WaitForExit();
            exitCode = splash.Child.ExitCode;
        }
        try
        {
            if (signal != null && File.Exists(signal)) File.Delete(signal);
        }
        catch
        {
            // The signal file is disposable; deletion must never block shutdown.
        }
        return exitCode;
    }

    private static string JoinQuoted(string[] args)
    {
        string joined = "";
        foreach (string argument in args)
        {
            string quoted = argument;
            if (argument.Length == 0 || argument.Contains(" ") || argument.Contains("\t"))
            {
                // Backslashes right before a closing quote escape it, so double them.
                int trailing = 0;
                for (int i = argument.Length - 1; i >= 0 && argument[i] == '\\'; i--) trailing++;
                quoted = "\"" + argument.Substring(0, argument.Length - trailing) + new string('\\', trailing * 2) + "\"";
            }
            joined = joined.Length == 0 ? quoted : joined + " " + quoted;
        }
        return joined;
    }
}

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
//   <App>.exe --update <iconPath>             Update: shown while an update installs, from a
//                                             temporary copy. Closes when the updated app's
//                                             launcher starts, which draws the same splash.
//   <App>.exe <iconPath> <signalPath>         Wait: show until the signal file exists.
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
    private const int LifetimeMs = 120000;

    private readonly float scale;
    private readonly Bitmap logo;
    private readonly string signalPath;
    private readonly string handoverPath;
    private readonly Process child;
    private readonly string launchExe;
    private readonly bool isLauncher;
    private readonly Timer spinTimer;
    private float angle;
    private int childExitCode;

    internal Splash(string iconPath, string signalPath, string handoverPath, string childArguments, string launchExe)
    {
        this.signalPath = signalPath;
        this.handoverPath = handoverPath;
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

        Timer lifetime = new Timer();
        lifetime.Interval = LifetimeMs;
        lifetime.Tick += delegate { Close(); };
        if (child == null) lifetime.Start(); // Only for the orphan-prone wait and update modes.

        Timer doneTimer = new Timer();
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
            Close();
        };
        doneTimer.Start();

        spinTimer = new Timer();
        spinTimer.Interval = 30;
        spinTimer.Tick += delegate
        {
            angle = (angle + 6f) % 360f;
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
        if (args.Length == 2 && args[0] == "--update")
        {
            icon = args[1];
            signal = handover;
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

        Splash splash = new Splash(icon, signal, handoverToWrite, launch != null ? JoinQuoted(args) : null, launch);
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

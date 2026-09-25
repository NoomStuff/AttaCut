// Minimal native boot splash for AttaCut launches, shown while Electron is still
// starting. Compiled with the .NET Framework csc.exe that ships with Windows, so the
// source must stay C# 5 compatible.
//
// Usage:
//   attacut-splash.exe <iconPath> <signalPath>            Wait for the signal file, then close.
//   attacut-splash.exe <iconPath> <signalPath> --launch <appExe>
//                                                         Also start the app, pass the signal
//                                                         path to it, and forward its exit code.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

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
    private readonly Process child;
    private readonly bool isLauncher;
    private readonly Timer spinTimer;
    private float angle;
    private int childExitCode;

    internal Splash(string iconPath, string signalPath, string childArguments, string launchExe)
    {
        this.signalPath = signalPath;
        using (Graphics measure = CreateGraphics()) scale = measure.DpiX / 96f;

        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Color.FromArgb(23, 25, 28);
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
            child = Launch(launchExe, signalPath, childArguments);
            if (child == null) childExitCode = 1;
        }

        Timer lifetime = new Timer();
        lifetime.Interval = LifetimeMs;
        lifetime.Tick += delegate { Close(); };
        if (child == null) lifetime.Start(); // Only for the orphan-prone wait-only mode.

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

    private static Process Launch(string appExe, string signalPath, string childArguments)
    {
        try
        {
            string full = Path.GetFullPath(appExe);
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = full;
            start.Arguments = childArguments ?? "";
            start.WorkingDirectory = Path.GetDirectoryName(full);
            start.UseShellExecute = false;
            start.EnvironmentVariables["ATTACUT_SPLASH_SIGNAL"] = signalPath ?? "";
            return Process.Start(start);
        }
        catch
        {
            return null;
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
        using (Pen border = new Pen(Color.FromArgb(42, 47, 54)))
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
        using (Pen arc = new Pen(Color.FromArgb(155, 201, 240), 3f * scale))
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

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    // Wait-only mode takes explicit icon and signal paths. Launcher mode is picked when a
    // sibling AttaCut-app.exe exists: the splash shows immediately, the real app starts
    // with a fresh signal path in its environment, all command-line arguments are
    // forwarded untouched, and the process waits for the app so packaging wrappers that
    // ExecWait this launcher see its real exit code.
    [STAThread]
    private static int Main(string[] args)
    {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string selfDir = Path.GetDirectoryName(Application.ExecutablePath);
        string appExe = Path.Combine(selfDir, "AttaCut-app.exe");
        bool launcherMode = File.Exists(appExe);

        string icon;
        string signal;
        string launch = null;
        if (launcherMode)
        {
            icon = Path.Combine(selfDir, "resources", "icons", "icon.png");
            signal = Path.Combine(Path.GetTempPath(), "attacut-splash-" + Guid.NewGuid().ToString("N") + ".signal");
            launch = appExe;
        }
        else
        {
            icon = args.Length > 0 ? args[0] : null;
            signal = args.Length > 1 ? args[1] : null;
        }

        Splash splash = new Splash(icon, signal, launcherMode ? JoinQuoted(args) : null, launch);
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

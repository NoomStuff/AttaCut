// Runs only on a disposable Windows desktop. This foreground window stands in
// for Explorer, launching the packaged app while its existing window is behind it.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class ForegroundSmoke
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint thread, uint otherThread, bool attach);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [STAThread]
    private static int Main(string[] args)
    {
        int runtimeId = Int32.Parse(args[0]);
        Process runtime = Process.GetProcessById(runtimeId);
        int result = 1;
        bool launched = false;
        bool minimized = args[3] == "minimized";
        DateTime deadline = DateTime.UtcNow.AddSeconds(10);
        using (Form explorer = new Form())
        using (Timer timer = new Timer())
        {
            explorer.Text = "AttaCut foreground regression test";
            explorer.Shown += delegate
            {
                if (minimized)
                {
                    runtime.Refresh();
                    ShowWindow(runtime.MainWindowHandle, 6);
                    if (!IsIconic(runtime.MainWindowHandle)) throw new Exception("Could not minimize the app before the test");
                }
                explorer.Activate();
            };
            timer.Interval = 50;
            timer.Tick += delegate
            {
                if (DateTime.UtcNow > deadline)
                {
                    Console.Error.WriteLine("Foreground handoff timed out for " + args[3] + ", launched=" + launched);
                    explorer.Close();
                    return;
                }
                uint foregroundId;
                GetWindowThreadProcessId(GetForegroundWindow(), out foregroundId);
                if (!launched)
                {
                    if (foregroundId != (uint)Process.GetCurrentProcess().Id)
                    {
                        // Only the test host uses joined input queues to establish
                        // its foreground baseline on the unattended runner. Detach
                        // before launching, so the app must use the real handoff.
                        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundId);
                        uint thread = GetCurrentThreadId();
                        bool attached = foregroundThread != 0 && AttachThreadInput(thread, foregroundThread, true);
                        try { SetForegroundWindow(explorer.Handle); }
                        finally { if (attached) AttachThreadInput(thread, foregroundThread, false); }
                        return;
                    }
                    // The foreground process starts the real launcher, just as Explorer
                    // does for a file association. No test-side foreground grant.
                    ProcessStartInfo start = new ProcessStartInfo(args[1], "\"" + args[2] + "\"");
                    start.UseShellExecute = false;
                    using (Process launch = Process.Start(start)) { }
                    launched = true;
                    deadline = DateTime.UtcNow.AddSeconds(15);
                }
                else if (foregroundId == (uint)runtimeId)
                {
                    runtime.Refresh();
                    if (IsIconic(runtime.MainWindowHandle)) return;
                    result = 0;
                    explorer.Close();
                }
            };
            timer.Start();
            Application.Run(explorer);
        }
        runtime.Dispose();
        return result;
    }
}

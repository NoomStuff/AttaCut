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

    [STAThread]
    private static int Main(string[] args)
    {
        int runtimeId = Int32.Parse(args[0]);
        Process runtime = Process.GetProcessById(runtimeId);
        int result = 1;
        int stage = 0;
        DateTime deadline = DateTime.UtcNow.AddSeconds(10);
        using (Form explorer = new Form())
        using (Timer timer = new Timer())
        {
            explorer.Text = "AttaCut foreground regression test";
            explorer.Shown += delegate { explorer.Activate(); };
            timer.Interval = 50;
            timer.Tick += delegate
            {
                if (DateTime.UtcNow > deadline)
                {
                    Console.Error.WriteLine("Foreground handoff timed out at stage " + stage);
                    explorer.Close();
                    return;
                }
                uint foregroundId;
                GetWindowThreadProcessId(GetForegroundWindow(), out foregroundId);
                if (stage == 0 || stage == 2)
                {
                    if (foregroundId != (uint)Process.GetCurrentProcess().Id) return;
                    // The foreground process starts the real launcher, just as Explorer
                    // does for a file association. No test-side foreground grant.
                    ProcessStartInfo start = new ProcessStartInfo(args[1], "\"" + args[2] + "\"");
                    start.UseShellExecute = false;
                    using (Process launch = Process.Start(start)) { }
                    stage++;
                    deadline = DateTime.UtcNow.AddSeconds(15);
                }
                else if (foregroundId == (uint)runtimeId)
                {
                    runtime.Refresh();
                    if (IsIconic(runtime.MainWindowHandle)) return;
                    if (stage == 1)
                    {
                        // Repeat with a minimized app, so focus alone cannot pass.
                        ShowWindow(runtime.MainWindowHandle, 6);
                        explorer.Activate();
                        stage = 2;
                        deadline = DateTime.UtcNow.AddSeconds(10);
                    }
                    else
                    {
                        result = 0;
                        explorer.Close();
                    }
                }
            };
            timer.Start();
            Application.Run(explorer);
        }
        runtime.Dispose();
        return result;
    }
}

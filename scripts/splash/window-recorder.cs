// Update test probe: records every visible top-level window and every process whose image
// path matches one of the given fragments, one JSON line per change, until the stop file
// exists. A dialog from a watched process also captures the screen as evidence.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class WindowRecorder
{
   delegate bool EnumProc(IntPtr handle, IntPtr parameter);
   [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
   [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
   [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
   [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
   [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr handle, StringBuilder text, int length);
   [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle, out Rect rect);
   [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
   [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int length);
   [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
   struct Rect { public int Left, Top, Right, Bottom; }

   static string ImagePath(uint pid)
   {
      IntPtr process = OpenProcess(0x1000, false, pid);
      if (process == IntPtr.Zero) return "";
      try
      {
         var name = new StringBuilder(1024);
         int length = name.Capacity;
         return QueryFullProcessImageName(process, 0, name, ref length) ? name.ToString() : "";
      }
      finally { CloseHandle(process); }
   }

   static string Json(string value)
   {
      var text = new StringBuilder("\"");
      foreach (char c in value)
      {
         if (c == '"' || c == '\\') text.Append('\\').Append(c);
         else if (c < ' ') text.AppendFormat("\\u{0:x4}", (int)c);
         else text.Append(c);
      }
      return text.Append('"').ToString();
   }

   static int Main(string[] args)
   {
      string output = args[0], stop = args[1], shots = args[2];
      string[] watched = args[3].ToLowerInvariant().Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
      Func<string, bool> isWatched = path =>
      {
         string lower = path.ToLowerInvariant();
         foreach (string fragment in watched) if (lower.Contains(fragment)) return true;
         return false;
      };
      string previous = null;
      var captured = new HashSet<long>();
      int shotCount = 0;
      using (var writer = new StreamWriter(output, false, new UTF8Encoding(false)))
      {
         writer.AutoFlush = true;
         while (!File.Exists(stop))
         {
            var windows = new List<string>();
            var dialogs = new List<long>();
            var paths = new Dictionary<uint, string>();
            EnumWindows((handle, parameter) =>
            {
               if (!IsWindowVisible(handle)) return true;
               Rect rect;
               if (!GetWindowRect(handle, out rect) || rect.Right - rect.Left <= 0 || rect.Bottom - rect.Top <= 0) return true;
               uint pid;
               GetWindowThreadProcessId(handle, out pid);
               string path;
               if (!paths.TryGetValue(pid, out path)) paths[pid] = path = ImagePath(pid);
               var title = new StringBuilder(512);
               GetWindowText(handle, title, title.Capacity);
               var kind = new StringBuilder(256);
               GetClassName(handle, kind, kind.Capacity);
               windows.Add("{\"hwnd\":" + handle.ToInt64() + ",\"pid\":" + pid + ",\"path\":" + Json(path) + ",\"class\":" + Json(kind.ToString()) + ",\"title\":" + Json(title.ToString()) + "}");
               if (isWatched(path) && !path.ToLowerInvariant().EndsWith("\\attacut-app.exe") && !path.ToLowerInvariant().EndsWith("\\attacut.exe")) dialogs.Add(handle.ToInt64());
               else if (kind.ToString() == "#32770") dialogs.Add(handle.ToInt64());
               return true;
            }, IntPtr.Zero);
            var processes = new List<string>();
            foreach (Process process in Process.GetProcesses())
            {
               string path = ImagePath((uint)process.Id);
               if (path.Length > 0 && isWatched(path)) processes.Add("{\"pid\":" + process.Id + ",\"path\":" + Json(path) + "}");
               process.Dispose();
            }
            windows.Sort(StringComparer.Ordinal);
            processes.Sort(StringComparer.Ordinal);
            string state = "\"windows\":[" + string.Join(",", windows) + "],\"processes\":[" + string.Join(",", processes) + "]";
            if (state != previous)
            {
               writer.WriteLine("{\"t\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "," + state + "}");
               previous = state;
            }
            foreach (long dialog in dialogs)
            {
               if (!captured.Add(dialog) || shotCount >= 8) continue;
               try
               {
                  Rectangle bounds = SystemInformation.VirtualScreen;
                  using (var image = new Bitmap(bounds.Width, bounds.Height))
                  using (var graphics = Graphics.FromImage(image))
                  {
                     graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
                     image.Save(Path.Combine(shots, "window-" + (++shotCount) + ".png"), ImageFormat.Png);
                  }
               }
               catch (Exception) { }
            }
            Thread.Sleep(100);
         }
      }
      return 0;
   }
}

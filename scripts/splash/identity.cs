// What the shared splash.cs needs to know about this app. Everything else in the
// splash is the same in AcroClip, AttaCut and Deduup.
using System.Drawing;

internal static class Identity
{
    internal const string Name = "AttaCut";
    internal const string Slug = "attacut";
    // electron-builder's product executable becomes the launcher; Electron runs as this.
    internal const string RuntimeExe = "AttaCut-app.exe";
    internal const string SignalVariable = "ATTACUT_SPLASH_SIGNAL";
    internal static readonly Color Background = Color.FromArgb(23, 25, 28);
    internal static readonly Color Border = Color.FromArgb(42, 47, 54);
    internal static readonly Color Accent = Color.FromArgb(155, 201, 240);
    // Arguments that run a command instead of opening the app, so they skip the splash.
    internal static readonly string[] QuietArguments = new string[] {  };
}

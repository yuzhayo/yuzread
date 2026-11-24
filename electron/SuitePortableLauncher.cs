using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Yuzread")]
[assembly: AssemblyDescription("Yuzread suite launcher")]
[assembly: AssemblyCompany("Yuzread")]
[assembly: AssemblyProduct("Yuzread")]
[assembly: AssemblyVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyFileVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyInformationalVersion("__SUITE_VERSION__")]

internal static class SuitePortableLauncher
{
    private const string RegisteredName = "Yuzread Reader";
    private const string ProgId = "Yuzread.Reader.CBZ.1";
    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);

    private static readonly HashSet<string> Roles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "reader", "library", "downloader"
    };

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        var output = "\"";
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                output += new string('\\', slashes * 2 + 1) + '"';
                slashes = 0;
                continue;
            }
            output += new string('\\', slashes) + character;
            slashes = 0;
        }
        return output + new string('\\', slashes * 2) + "\"";
    }

    private static void SetDefault(RegistryKey parent, string path, string value)
    {
        using (var key = parent.CreateSubKey(path))
        {
            if (key == null) throw new InvalidOperationException("Windows registry key could not be created: " + path);
            key.SetValue(string.Empty, value, RegistryValueKind.String);
        }
    }

    private static void RegisterCbz(string root, bool openSettings)
    {
        var reader = Path.Combine(root, "yuzread-reader.exe");
        if (!File.Exists(reader) || !File.Exists(Path.Combine(root, "portable.json")))
            throw new InvalidOperationException("CBZ registration requires the complete portable Yuzread folder.");
        var quotedReader = "\"" + reader + "\"";
        var command = quotedReader + " \"%1\"";
        using (var classes = Registry.CurrentUser.CreateSubKey(@"Software\Classes"))
        {
            if (classes == null) throw new InvalidOperationException("Current-user file associations are unavailable.");
            SetDefault(classes, ProgId, "Yuzread Comic Book Archive");
            using (var progId = classes.CreateSubKey(ProgId))
                progId.SetValue("AppUserModelID", "com.yuzread.desktop", RegistryValueKind.String);
            SetDefault(classes, ProgId + @"\DefaultIcon", quotedReader + ",0");
            SetDefault(classes, ProgId + @"\shell\open\command", command);
            using (var verb = classes.CreateSubKey(ProgId + @"\shell\open"))
                verb.SetValue("MUIVerb", "Open with Yuzread Reader", RegistryValueKind.String);
            using (var openWith = classes.CreateSubKey(@".cbz\OpenWithProgids"))
                openWith.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            const string application = @"Applications\yuzread-reader.exe";
            using (var app = classes.CreateSubKey(application))
            {
                app.SetValue("FriendlyAppName", RegisteredName, RegistryValueKind.String);
                app.SetValue("ApplicationCompany", "Yuzread", RegistryValueKind.String);
            }
            SetDefault(classes, application + @"\DefaultIcon", quotedReader + ",0");
            SetDefault(classes, application + @"\shell\open\command", command);
            using (var types = classes.CreateSubKey(application + @"\SupportedTypes"))
                types.SetValue(".cbz", new byte[0], RegistryValueKind.None);
        }
        const string capabilitiesPath = @"Software\Yuzread\Reader\Capabilities";
        using (var capabilities = Registry.CurrentUser.CreateSubKey(capabilitiesPath))
        {
            if (capabilities == null) throw new InvalidOperationException("Yuzread capabilities could not be registered.");
            capabilities.SetValue("ApplicationName", RegisteredName, RegistryValueKind.String);
            capabilities.SetValue("ApplicationDescription", "Read CBZ comic book archives with Yuzread Reader.", RegistryValueKind.String);
            capabilities.SetValue("ApplicationIcon", quotedReader + ",0", RegistryValueKind.String);
            using (var files = capabilities.CreateSubKey("FileAssociations"))
                files.SetValue(".cbz", ProgId, RegistryValueKind.String);
        }
        using (var registered = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications"))
        {
            if (registered == null) throw new InvalidOperationException("Windows RegisteredApplications is unavailable.");
            registered.SetValue(RegisteredName, capabilitiesPath, RegistryValueKind.String);
        }
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
        if (openSettings)
            Process.Start(new ProcessStartInfo
            {
                FileName = "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(RegisteredName),
                UseShellExecute = true
            });
    }

    private static void UnregisterCbz()
    {
        using (var registered = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true))
            if (registered != null) registered.DeleteValue(RegisteredName, false);
        using (var classes = Registry.CurrentUser.OpenSubKey(@"Software\Classes", true))
        {
            if (classes != null)
            {
                using (var openWith = classes.OpenSubKey(@".cbz\OpenWithProgids", true))
                    if (openWith != null) openWith.DeleteValue(ProgId, false);
                classes.DeleteSubKeyTree(ProgId, false);
                classes.DeleteSubKeyTree(@"Applications\yuzread-reader.exe", false);
            }
        }
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Yuzread\Reader", false);
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            if (args.Length == 1 && (args[0] == "--register-cbz" || args[0] == "--register-cbz-silent"))
            {
                RegisterCbz(root, args[0] == "--register-cbz");
                return 0;
            }
            if (args.Length == 1 && args[0] == "--remove-cbz-registration")
            {
                UnregisterCbz();
                return 0;
            }
            var selected = "__DEFAULT_APPLICATION__";
            var forwarded = new List<string>();
            var explicitSelection = false;
            for (var index = 0; index < args.Length; index++)
            {
                var argument = args[index];
                if (argument.StartsWith("--app=", StringComparison.OrdinalIgnoreCase))
                {
                    if (explicitSelection) throw new ArgumentException("Select only one Yuzread application.");
                    selected = argument.Substring("--app=".Length);
                    explicitSelection = true;
                }
                else if (index == 0 && Roles.Contains(argument))
                {
                    if (explicitSelection) throw new ArgumentException("Select only one Yuzread application.");
                    selected = argument;
                    explicitSelection = true;
                }
                else forwarded.Add(argument);
            }
            if (!Roles.Contains(selected)) throw new ArgumentException("Unknown Yuzread application: " + selected);
            var executable = Path.Combine(root, "yuzread-" + selected.ToLowerInvariant() + ".exe");
            if (!File.Exists(executable)) throw new FileNotFoundException("The selected Yuzread application is missing.", executable);
            var temp = Path.Combine(root, "cache", selected.ToLowerInvariant(), "temp");
            Directory.CreateDirectory(temp);
            var start = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = root,
                UseShellExecute = false,
                Arguments = string.Join(" ", forwarded.ConvertAll(Quote).ToArray())
            };
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables["TEMP"] = temp;
            start.EnvironmentVariables["TMP"] = temp;
            var process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("The selected Yuzread application did not start.");
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Yuzread could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

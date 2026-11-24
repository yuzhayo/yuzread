param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Icon,
    [Parameter(Mandatory = $true)][string]$VersionResource
)
$ErrorActionPreference = 'Stop'

# CONFIG AND CONTRACT — Windows resource adapter; only the caller's staged EXE is changed.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class YuzreadExecutableResources {
    private delegate bool NameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
    private delegate bool LanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryExW(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EnumResourceNamesW(IntPtr module, IntPtr type, NameCallback callback, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EnumResourceLanguagesW(IntPtr module, IntPtr type, IntPtr name, LanguageCallback callback, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr BeginUpdateResourceW(string file, bool deleteExisting);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EndUpdateResourceW(IntPtr update, bool discard);
    private sealed class Resource {
        internal int Type, Number;
        internal string Name;
        internal ushort Language;
    }

    // DISCOVERY — replace every existing icon-group/version language, preserving other resources.
    private static List<Resource> Inventory(string file) {
        var result = new List<Resource>();
        IntPtr module = LoadLibraryExW(file, IntPtr.Zero, 0x22);
        if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            foreach (int type in new int[] { 14, 16 }) {
                NameCallback names = (m, t, n, p) => {
                    bool numeric = ((ulong)n.ToInt64() >> 16) == 0;
                    string name = numeric ? null : Marshal.PtrToStringUni(n);
                    int number = numeric ? n.ToInt32() : 0;
                    LanguageCallback languages = (lm, lt, ln, language, lp) => {
                        result.Add(new Resource { Type = type, Number = number, Name = name, Language = language });
                        return true;
                    };
                    if (!EnumResourceLanguagesW(m, t, n, languages, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    return true;
                };
                if (!EnumResourceNamesW(module, new IntPtr(type), names, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        } finally { FreeLibrary(module); }
        return result;
    }

    // LOGIC AND OUTPUT — standard ICO entries become RT_ICON plus RT_GROUP_ICON.
    private static void Write(IntPtr update, int type, int number, string name, ushort language, byte[] bytes) {
        IntPtr pointer = name == null ? new IntPtr(number) : Marshal.StringToHGlobalUni(name);
        try {
            if (!UpdateResourceW(update, new IntPtr(type), pointer, language, bytes, (uint)bytes.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { if (name != null) Marshal.FreeHGlobal(pointer); }
    }
    public static void Apply(string executable, string icon, string versionResource) {
        var resources = Inventory(executable);
        byte[] ico = File.ReadAllBytes(icon), version = File.ReadAllBytes(versionResource);
        if (ico.Length < 6 || BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) throw new InvalidDataException("Invalid ICO header");
        int count = BitConverter.ToUInt16(ico, 4);
        if (count < 1 || count > 32 || ico.Length < 6 + count * 16) throw new InvalidDataException("Invalid ICO directory");
        byte[] group = new byte[6 + count * 14];
        Array.Copy(ico, 0, group, 0, 6);
        IntPtr update = BeginUpdateResourceW(executable, false);
        if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            for (int i = 0; i < count; i++) {
                int entry = 6 + i * 16, size = checked((int)BitConverter.ToUInt32(ico, entry + 8)), offset = checked((int)BitConverter.ToUInt32(ico, entry + 12));
                if (size < 1 || offset < 6 + count * 16 || offset > ico.Length - size) throw new InvalidDataException("Invalid ICO image bounds");
                byte[] image = new byte[size];
                Array.Copy(ico, offset, image, 0, size);
                Array.Copy(ico, entry, group, 6 + i * 14, 12);
                ushort id = checked((ushort)(60000 + i));
                Array.Copy(BitConverter.GetBytes(id), 0, group, 6 + i * 14 + 12, 2);
                Write(update, 3, id, null, 1033, image);
            }
            foreach (var resource in resources) Write(update, resource.Type, resource.Number, resource.Name, resource.Language, resource.Type == 14 ? group : version);
            if (!EndUpdateResourceW(update, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
            update = IntPtr.Zero;
        } finally { if (update != IntPtr.Zero) EndUpdateResourceW(update, true); }
    }
}
'@

# LIFECYCLE AND CLEANUP — commits atomically through EndUpdateResource; failures discard.
[YuzreadExecutableResources]::Apply($Executable, $Icon, $VersionResource)

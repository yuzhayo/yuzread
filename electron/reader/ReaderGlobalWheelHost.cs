// LOGIC — Windows low-level wheel hook for Reader "Scroll Anywhere".
// One hidden helper process per Reader window. It consumes ordinary vertical wheel
// input only while armed, only while the pointer is outside the Reader window, and
// only when no modifier key is held, so Ctrl+wheel zoom and horizontal input keep
// their normal meaning. Everything else passes through untouched.
// Windows reports wheel-away-from-user as a positive delta, while the reader's wheel
// path uses the browser convention where wheel-toward-user (scroll down) is positive.
// The sign is converted here, in the mouse hook, so every consumer downstream shares
// one convention.
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class ReaderGlobalWheelHost
{
    private const string MutexName = @"Local\Yuzread.ReaderGlobalWheel.v1";
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_QUIT = 0x0012;
    private const int WM_TIMER = 0x0113;
    private const int LLMHF_INJECTED = 0x00000001;
    private const int SPI_GETWHEELSCROLLLINES = 0x0068;
    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int LeaseMs = 3000;
    private const int PumpTimerMs = 500;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG message, IntPtr window, uint filterMin, uint filterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint elapse, IntPtr proc);

    [DllImport("user32.dll")]
    private static extern bool KillTimer(IntPtr window, UIntPtr id);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int key);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(int action, uint param, out uint value, uint flags);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();

    private static long NowMs()
    {
        return (long)GetTickCount64();
    }

    private static readonly object Gate = new object();
    private static HookProc hookCallback = Hook;
    private static IntPtr hook = IntPtr.Zero;
    private static UIntPtr timerId = UIntPtr.Zero;
    private static IntPtr targetWindow = IntPtr.Zero;
    private static bool armed;
    private static long revision;
    private static long sequence;
    private static long lastContact = NowMs();
    private static uint mainThreadId;

    private static int Main()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch (EntryPointNotFoundException)
        {
            // Older Windows: default awareness still yields consistent rect/hook units.
        }
        catch (DllNotFoundException)
        {
        }

        bool owned;
        using (var mutex = new Mutex(true, MutexName, out owned))
        {
            if (!owned)
            {
                Emit("fault already running");
                return 3;
            }
            try
            {
                mainThreadId = GetCurrentThreadId();
                hook = SetWindowsHookEx(WH_MOUSE_LL, hookCallback, IntPtr.Zero, 0);
                if (hook == IntPtr.Zero)
                {
                    Emit("fault hook install failed");
                    return 2;
                }
                timerId = SetTimer(IntPtr.Zero, UIntPtr.Zero, PumpTimerMs, IntPtr.Zero);
                if (timerId == UIntPtr.Zero)
                {
                    UnhookWindowsHookEx(hook);
                    hook = IntPtr.Zero;
                    Emit("fault timer install failed");
                    return 2;
                }
                var input = new Thread(InputLoop) { IsBackground = true, Name = "wheel-input" };
                input.Start();
                Emit("ready 1");
                return Pump();
            }
            finally
            {
                if (timerId != UIntPtr.Zero)
                {
                    KillTimer(IntPtr.Zero, timerId);
                    timerId = UIntPtr.Zero;
                }
                if (hook != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(hook);
                    hook = IntPtr.Zero;
                }
                mutex.ReleaseMutex();
            }
        }
    }

    // STATE — one stdin command per line; unknown commands are reported, never guessed.
    private static void InputLoop()
    {
        try
        {
            using (var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    Interlocked.Exchange(ref lastContact, NowMs());
                    if (!HandleCommand(line))
                        break;
                }
            }
        }
        catch (IOException)
        {
        }
        finally
        {
            lock (Gate)
            {
                armed = false;
            }
            PostThreadMessage(mainThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }
    }

    private static bool HandleCommand(string line)
    {
        var parts = line.Trim().Split(' ');
        switch (parts.Length > 0 ? parts[0] : string.Empty)
        {
            case "configure":
                return Configure(parts);
            case "heartbeat":
                return true;
            case "shutdown":
                return false;
            case "":
                return true;
            default:
                Emit("fault unknown command");
                return true;
        }
    }

    private static bool Configure(string[] parts)
    {
        if (parts.Length != 4)
        {
            Emit("fault configure expects active hwnd revision");
            return true;
        }
        bool next;
        if (parts[1] == "1") next = true;
        else if (parts[1] == "0") next = false;
        else
        {
            Emit("fault configure active must be 0 or 1");
            return true;
        }
        long handle;
        if (!long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out handle) || handle <= 0)
        {
            Emit("fault configure hwnd must be a positive handle");
            return true;
        }
        long nextRevision;
        if (!long.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out nextRevision))
        {
            Emit("fault configure revision must be a non-negative integer");
            return true;
        }
        lock (Gate)
        {
            targetWindow = new IntPtr(handle);
            revision = nextRevision;
            armed = next;
            sequence = 0;
        }
        return true;
    }

    private static int Pump()
    {
        MSG message;
        while (true)
        {
            var result = GetMessage(out message, IntPtr.Zero, 0, 0);
            if (result == 0 || result == -1) break;
            if (message.message == WM_TIMER &&
                NowMs() - Interlocked.Read(ref lastContact) > LeaseMs)
            {
                break;
            }
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        Emit("bye");
        return 0;
    }

    private static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && (int)wParam == WM_MOUSEWHEEL)
        {
            try
            {
                if (ShouldConsume(lParam)) return new IntPtr(1);
            }
            catch (Exception)
            {
                // A hook must never throw into the OS; a failure simply passes input through.
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    // LOGIC — consume only ordinary vertical wheel outside the Reader window.
    private static bool ShouldConsume(IntPtr data)
    {
        IntPtr window;
        long currentRevision;
        lock (Gate)
        {
            if (!armed) return false;
            window = targetWindow;
            currentRevision = revision;
        }
        if (window == IntPtr.Zero || !IsWindow(window)) return false;
        if (ModifierHeld()) return false;
        var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(MSLLHOOKSTRUCT));
        if ((info.flags & LLMHF_INJECTED) != 0) return false;
        if (!IsWindowVisible(window) || IsIconic(window)) return false;
        RECT rect;
        if (!GetWindowRect(window, out rect)) return false;
        var inside =
            info.pt.X >= rect.Left && info.pt.X < rect.Right &&
            info.pt.Y >= rect.Top && info.pt.Y < rect.Bottom;
        if (inside) return false;
        var delta = unchecked((short)((info.mouseData >> 16) & 0xFFFF));
        if (delta == 0) return false;
        // Convert the Windows wheel sign to the reader's browser convention: wheel toward
        // the user (scroll down) becomes positive, so no consumer has to know this rule.
        var browserDelta = -(int)delta;
        var stamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long next;
        lock (Gate)
        {
            if (!armed || revision != currentRevision) return false;
            next = ++sequence;
        }
        Emit(string.Format(
            CultureInfo.InvariantCulture,
            "wheel {0} {1} {2} {3} {4}",
            browserDelta,
            WheelLines(),
            stamp,
            currentRevision,
            next));
        return true;
    }

    private static bool ModifierHeld()
    {
        return Down(VK_CONTROL) || Down(VK_SHIFT) || Down(VK_MENU) || Down(VK_LWIN) || Down(VK_RWIN);
    }

    private static bool Down(int key)
    {
        return (GetKeyState(key) & 0x8000) != 0;
    }

    // Lines per notch: -1 means "one page", matching Windows' own page-scroll setting.
    private static int WheelLines()
    {
        uint value;
        if (!SystemParametersInfo(SPI_GETWHEELSCROLLLINES, 0, out value, 0)) return 3;
        if (value == uint.MaxValue) return -1;
        if (value == 0) return 1;
        return (int)Math.Min(value, 100);
    }

    private static void Emit(string line)
    {
        try
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
        catch (IOException)
        {
        }
    }
}

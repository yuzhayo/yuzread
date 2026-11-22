param(
  [Parameter(Mandatory=$true)][long]$WindowHandle,
  [Parameter(Mandatory=$true)][double]$FractionX,
  [Parameter(Mandatory=$true)][double]$FractionY,
  [int]$DeltaX = 70,
  [int]$DeltaY = 45
)

$ErrorActionPreference = 'Stop'

# LOGIC — send input only to the positively identified foreground test window.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class YuzreadDragProof {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTDATA { [FieldOffset(0)] public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTDATA data; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint current, uint target, bool attach);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref POINT point);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] input, int size);
  static void Button(uint flags) {
    var input = new INPUT { type = 0, data = new INPUTDATA { mouse = new MOUSEINPUT { dwFlags = flags } } };
    if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("Native input rejected");
  }
  static void MoveTo(int x, int y) {
    int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
    int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    var input = new INPUT { type = 0, data = new INPUTDATA { mouse = new MOUSEINPUT {
      dx = (int)Math.Round((x - left) * 65535.0 / (width - 1)),
      dy = (int)Math.Round((y - top) * 65535.0 / (height - 1)), dwFlags = 0x0001 | 0x8000 | 0x4000
    } } };
    if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("Native mouse movement rejected");
  }
  public static int[] Run(long handle, double fx, double fy, int dx, int dy) {
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) throw new Exception("Target point must stay inside the client area");
    var window = new IntPtr(handle);
    var previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    POINT original; GetCursorPos(out original);
    bool pressed = false;
    try {
      uint current = GetCurrentThreadId();
      uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
      uint target = GetWindowThreadProcessId(window, IntPtr.Zero);
      bool foregroundAttached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
      bool targetAttached = target != 0 && target != current && target != foreground && AttachThreadInput(current, target, true);
      try {
        ShowWindow(window, 9);
        BringWindowToTop(window);
        SetForegroundWindow(window);
        SetActiveWindow(window);
        SetFocus(window);
      } finally {
        if (targetAttached) AttachThreadInput(current, target, false);
        if (foregroundAttached) AttachThreadInput(current, foreground, false);
      }
      Thread.Sleep(120);
      if (GetForegroundWindow() != window) throw new Exception("Test window is not foreground; no input sent");
      RECT client, before, after; POINT origin = new POINT();
      if (!GetClientRect(window, out client) || !GetWindowRect(window, out before) || !ClientToScreen(window, ref origin)) throw new Exception("Cannot resolve target coordinates");
      int x = origin.X + (int)Math.Round((client.Right - client.Left) * fx);
      int y = origin.Y + (int)Math.Round((client.Bottom - client.Top) * fy);
      int hit = SendMessage(window, 0x0084, IntPtr.Zero, new IntPtr((x & 0xffff) | ((y & 0xffff) << 16))).ToInt32();
      SetCursorPos(x, y); Thread.Sleep(40);
      Button(0x0002); pressed = true;
      // Let the target process enter its native move/capture loop before motion.
      Thread.Sleep(150);
      for (int step = 1; step <= 12; step++) { MoveTo(x + dx * step / 12, y + dy * step / 12); Thread.Sleep(20); }
      Button(0x0004); pressed = false; Thread.Sleep(120);
      if (!GetWindowRect(window, out after)) throw new Exception("Cannot inspect resulting bounds");
      return new int[] { before.Left, before.Top, after.Left, after.Top, hit, client.Right - client.Left, client.Bottom - client.Top };
    } finally {
      if (pressed) Button(0x0004);
      SetCursorPos(original.X, original.Y);
      if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
    }
  }
}
'@
$bounds = [YuzreadDragProof]::Run($WindowHandle, $FractionX, $FractionY, $DeltaX, $DeltaY)
[pscustomobject]@{ before = @($bounds[0], $bounds[1]); after = @($bounds[2], $bounds[3]); dx = $bounds[2] - $bounds[0]; dy = $bounds[3] - $bounds[1]; nativeHit = $bounds[4]; clientWidth = $bounds[5]; clientHeight = $bounds[6] } | ConvertTo-Json -Compress

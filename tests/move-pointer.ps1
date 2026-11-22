param(
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y
)

# LOGIC — move the pointer. DPI awareness is required; otherwise the call is rejected.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YuzreadPointer {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static string Move(int x, int y) {
    var previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      if (!SetCursorPos(x, y)) throw new Exception("Native pointer movement was rejected");
      var point = new POINT();
      GetCursorPos(out point);
      return point.X + "," + point.Y;
    } finally { SetThreadDpiAwarenessContext(previous); }
  }
}
'@
[YuzreadPointer]::Move($X, $Y)

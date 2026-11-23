param(
  [Parameter(Mandatory)] [string] $Portable,
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [uint16] $Machine
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class ViewerFrame {
    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static int[] Read(IntPtr window) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            Rect rect;
            if (!GetWindowRect(window, out rect)) throw new Exception("GetWindowRect failed");
            return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
        } finally { SetThreadDpiAwarenessContext(previous); }
    }

    public static void Move(IntPtr window) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            if (!MoveWindow(window, 90, 100, 900, 640, true)) throw new Exception("MoveWindow failed");
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@

function Assert-AppMachine([string] $Path) {
  $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($Path))
  try {
    # The DOS header points to the PE signature, followed by the COFF machine ID.
    $reader.BaseStream.Position = 0x3C
    $reader.BaseStream.Position = $reader.ReadInt32()
    if ($reader.ReadUInt32() -ne 0x4550) { throw "Missing PE signature in $Path" }
    $actual = $reader.ReadUInt16()
    if ($actual -ne $Machine) {
      throw ('{0} has machine 0x{1:X4}, expected 0x{2:X4}' -f $Path, $actual, $Machine)
    }
  } finally {
    $reader.Dispose()
  }
}

function Test-PdfOpen([string] $Path, [string] $Fixture) {
  $session = Join-Path $env:APPDATA 'com.previewpromax.viewer/sessions.json'
  $app = Start-Process -FilePath $Path -ArgumentList ('"{0}"' -f $Fixture) -PassThru
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
      $app.Refresh()
      if ($app.HasExited) { throw "Viewer $Path exited with code $($app.ExitCode)" }
      if ($app.MainWindowHandle -ne [IntPtr]::Zero -and (Test-Path -LiteralPath $session)) {
        $saved = Get-Content -LiteralPath $session -Raw | ConvertFrom-Json
        $paths = $saved.windows | ForEach-Object { $_.tabs } | ForEach-Object { $_.path }
        if ($paths -contains $Fixture) { return }
      }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out opening $Fixture in $Path"
  } finally {
    if (!$app.HasExited) {
      Stop-Process -InputObject $app -Force
      $app.WaitForExit()
    }
    $app.Dispose()
  }
}

function Wait-ViewerWindow([Diagnostics.Process] $App) {
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $App.Refresh()
    if ($App.HasExited) { throw "Viewer exited with code $($App.ExitCode)" }
    if ($App.MainWindowHandle -ne [IntPtr]::Zero) { return $App.MainWindowHandle }
    Start-Sleep -Milliseconds 250
  }
  throw 'Timed out waiting for the viewer window'
}

function Test-FrameRestore([string] $Path, [string] $Fixture) {
  $session = Join-Path $env:APPDATA 'com.previewpromax.viewer/sessions.json'
  $app = Start-Process -FilePath $Path -PassThru
  try {
    $window = Wait-ViewerWindow $app
    [ViewerFrame]::Move($window)
    $expected = [ViewerFrame]::Read($window)
    $stored = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
      $saved = Get-Content -LiteralPath $session -Raw | ConvertFrom-Json
      $frame = ($saved.windows | Where-Object { $_.tabs.path -contains $Fixture } | Select-Object -First 1).frame
      if ($frame.kind -eq 'desktop' -and ($frame.position -join ',') -eq ($expected[0..1] -join ',')) {
        $stored = $true
        break
      }
      Start-Sleep -Milliseconds 250
    }
    if (!$stored) { throw 'Viewer did not save the moved window' }
    Stop-Process -InputObject $app -Force
    $app.WaitForExit()
    $app.Dispose()
    $app = Start-Process -FilePath $Path -PassThru
    $restored = [ViewerFrame]::Read((Wait-ViewerWindow $app))
    if (($restored -join ',') -ne ($expected -join ',')) {
      throw "Expected restored window at $expected, got $restored"
    }
  } finally {
    if (!$app.HasExited) {
      Stop-Process -InputObject $app -Force
      $app.WaitForExit()
    }
    $app.Dispose()
  }
}

$portablePath = (Resolve-Path -LiteralPath $Portable).Path
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$fixture = Join-Path $env:RUNNER_TEMP 'preview-test.pdf'
$installedFixture = Join-Path $env:RUNNER_TEMP 'preview installed test.pdf'
Copy-Item -LiteralPath $fixture -Destination $installedFixture

Assert-AppMachine $portablePath

# NSIS uses a 32-bit installer stub. Check the architecture of the installed app.
$installDir = Join-Path $env:RUNNER_TEMP 'Preview Pro Max'
$setup = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installDir" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "NSIS installer exited with code $($setup.ExitCode)" }
$installedApp = Join-Path $installDir 'preview-pro-max.exe'
Assert-AppMachine $installedApp
Test-PdfOpen $installedApp $installedFixture
Test-FrameRestore $installedApp $installedFixture
Test-PdfOpen $portablePath $fixture

param(
  [Parameter(Mandatory)] [string] $Portable,
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [uint16] $Machine
)

$ErrorActionPreference = 'Stop'

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
Test-PdfOpen $portablePath $fixture

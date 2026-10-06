# Raptr installer for Windows: irm https://airaptr.github.io/raptr/install.ps1 | iex
$ErrorActionPreference = "Stop"
if (-not $env:RAPTR_SRC) { Write-Host "Airaptr is in private build right now, so the public installer is paused. Try it in your browser meanwhile: https://airaptr.github.io/raptr/"; return }
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { Write-Host "Raptr needs Python 3.8 or newer: https://www.python.org/downloads/ (tick 'Add to PATH'), then run this again."; return }
$dir = Join-Path $env:LOCALAPPDATA "raptr"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest $env:RAPTR_SRC -OutFile (Join-Path $dir "raptr.py") -UseBasicParsing
Set-Content -Path (Join-Path $dir "raptr.cmd") -Value "@`"$($py.Source)`" `"%~dp0raptr.py`" %*" -Encoding ASCII
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $dir) { [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User") }
Write-Host "Raptr installed. Open a new terminal and run: raptr"
Write-Host "Free models work at `$0. You'll be asked for a free OpenRouter key on first run."

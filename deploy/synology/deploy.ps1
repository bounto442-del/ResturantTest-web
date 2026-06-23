# Deploy the static Restaurant web app to a Synology NAS shared folder.
# Run from the web_app repo root, e.g.:
#   .\deploy\synology\deploy.ps1 -NasIp "192.168.4.75" -User "Claude" -Share "usbshare1" -TargetFolder "WEB/Lets_Coffee_LLC"
param(
  [Parameter(Mandatory)] [string] $NasIp,
  [Parameter(Mandatory)] [string] $User,
  [SecureString] $Password = $null,
  [Parameter(Mandatory)] [string] $Share,
  [string] $TargetFolder = "restaurant",
  [string] $Source = ".",
  [string[]] $Exclude = @(".git", "node_modules", "deploy", "*.md", ".gitignore", "package*.json")
)

$ErrorActionPreference = "Stop"

function Get-FreeDriveLetter {
  for ($i = 90; $i -ge 68; $i--) {
    $letter = [char]$i
    $path = "$letter`:\"
    if (-not (Test-Path $path)) { return $letter }
  }
  throw "No free drive letter available"
}

if (-not $Password) {
  $Password = Read-Host "Enter password for $User" -AsSecureString
}

$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
$driveLetter = Get-FreeDriveLetter
$networkPath = "\\$NasIp\$Share"
$driveRoot = "$driveLetter`:\"

# Explicit directory vs file exclusions for robocopy.
$xdList = @(".git", "node_modules", "deploy", "__pycache__")
$xfList = @("*.md", ".gitignore", "package*.json", "*.log")

try {
  Write-Host "Mapping ${driveLetter}: to $networkPath ..."
  $netUseOutput = net use "${driveLetter}:" "$networkPath" "$plainPassword" /user:$User /persistent:no 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "net use failed: $netUseOutput"
  }

  $dest = Join-Path $driveRoot $TargetFolder
  if (-not (Test-Path $dest)) {
    Write-Host "Creating $dest ..."
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
  }

  $sourcePath = (Resolve-Path $Source).Path
  Write-Host "Copying static files from $sourcePath to $dest ..."

  $robocopyArgs = @($sourcePath, $dest, "/MIR", "/R:3", "/W:5")
  if ($xdList) {
    $robocopyArgs += "/XD"
    $robocopyArgs += $xdList
  }
  if ($xfList) {
    $robocopyArgs += "/XF"
    $robocopyArgs += $xfList
  }

  & robocopy @robocopyArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

  Write-Host "Done. App deployed to $networkPath\$TargetFolder"
} finally {
  net use "${driveLetter}:" /delete /y 2>&1 | Out-Null
}

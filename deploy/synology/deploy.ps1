# Deploy the static Restaurant web app to a Synology NAS shared folder.
# Run from the web_app repo root, e.g.:
#   .\deploy\synology\deploy.ps1 -NasIp "192.168.4.75" -User "Claude" -Share "web" -TargetFolder "restaurant"
param(
  [Parameter(Mandatory)] [string] $NasIp,
  [Parameter(Mandatory)] [string] $User,
  [Parameter(Mandatory)] [SecureString] $Password,
  [Parameter(Mandatory)] [string] $Share,
  [string] $TargetFolder = "restaurant",
  [string] $Source = ".",
  [string[]] $Exclude = @(".git", "node_modules", "deploy", "*.md", ".gitignore", "package*.json")
)

$ErrorActionPreference = "Stop"

$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
$driveLetter = $null

for ($c = [char]'Z'; $c -ge [char]'D'; $c--) {
  $letter = "$($c):"
  if (-not (Test-Path $letter)) { $driveLetter = $letter; break }
}

if (-not $driveLetter) { throw "No free drive letter available" }

try {
  Write-Host "Mapping $driveLetter to \\$NasIp\$Share ..."
  $cred = New-Object System.Management.Automation.PSCredential($User, (ConvertTo-SecureString $plainPassword -AsPlainText -Force))
  New-PSDrive -Name ($driveLetter.TrimEnd(':')) -PSProvider FileSystem -Root "\\$NasIp\$Share" -Credential $cred -Scope Script | Out-Null

  $dest = Join-Path $driveLetter $TargetFolder
  if (-not (Test-Path $dest)) {
    Write-Host "Creating $dest ..."
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
  }

  Write-Host "Copying static files to $dest ..."
  $robocopyArgs = @(
    (Resolve-Path $Source).Path,
    $dest,
    "/MIR",
    "/XD", ($Exclude | Where-Object { $_ -notlike "*.*" }) -join " ",
    "/XF", ($Exclude | Where-Object { $_ -like "*.*" }) -join " "
  ) | ForEach-Object { $_ }
  & robocopy @robocopyArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

  Write-Host "Done. App deployed to \\$NasIp\$Share\$TargetFolder"
} finally {
  if ($driveLetter) {
    Remove-PSDrive -Name ($driveLetter.TrimEnd(':')) -Force -ErrorAction SilentlyContinue
  }
}

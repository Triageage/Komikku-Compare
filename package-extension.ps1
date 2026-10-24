# Packaging script for Mozilla Firefox Add-on Store (AMO)
# Uses standard forward slashes ('/') in ZIP headers required by Mozilla AMO.

$manifestPath = "manifest.json"
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "manifest.json"))) {
    $manifestPath = Join-Path $PSScriptRoot "manifest.json"
    Set-Location $PSScriptRoot
}

if (-not (Test-Path $manifestPath)) {
    Write-Error "Could not find manifest.json to determine extension version."
    exit 1
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

if (-not $version) {
    Write-Error "Could not find 'version' field in manifest.json."
    exit 1
}

$outputZip = "komikku-compare-v$version.zip"

if (Test-Path $outputZip) {
    Remove-Item $outputZip -Force
}

$itemsToInclude = @(
    "manifest.json",
    "popup.html",
    "popup.js",
    "popup.css",
    "upload.html",
    "upload.js",
    "README.md",
    "lib",
    "icons"
)

Write-Host "Creating $outputZip for Mozilla AMO..."

# Use built-in Windows tar.exe which adheres strictly to POSIX forward slashes in ZIP archives
$tarPath = Get-Command tar.exe -ErrorAction SilentlyContinue

if ($tarPath) {
    & tar.exe -a -cf $outputZip @itemsToInclude
} else {
    # Fallback using .NET with explicit forward-slash normalization
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipStream = [System.IO.File]::Create((Join-Path (Get-Location) $outputZip))
    $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

    foreach ($item in $itemsToInclude) {
        if (Test-Path $item -PathType Container) {
            $files = Get-ChildItem -Path $item -Recurse -File
            foreach ($file in $files) {
                $relPath = ($file.FullName.Substring((Get-Location).Path.Length + 1)).Replace("\", "/")
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Optimal)
            }
        } elseif (Test-Path $item -PathType Leaf) {
            $file = Get-Item $item
            $relPath = $file.Name
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    }
    $archive.Dispose()
    $zipStream.Dispose()
}

if (Test-Path $outputZip) {
    $zipSize = (Get-Item $outputZip).Length / 1KB
    Write-Host ("Successfully packaged extension: {0} ({1:N1} KB) with standard POSIX forward slashes." -f $outputZip, $zipSize) -ForegroundColor Green
} else {
    Write-Host "Failed to create ZIP package." -ForegroundColor Red
}

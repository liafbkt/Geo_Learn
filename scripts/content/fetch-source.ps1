param(
    [string]$Url,
    [string]$ExpectedSha256,
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-SafeRawDestination {
    param([Parameter(Mandatory = $true)][string]$Destination)

    $scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
    $rawRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot 'raw'))
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    $rawPrefix = $rawRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $destinationPath.StartsWith($rawPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Destination must be inside scripts/content/raw.'
    }

    $destinationParent = [IO.Path]::GetDirectoryName($destinationPath)
    $relativeParent = [IO.Path]::GetRelativePath($rawRoot, $destinationParent)
    $pathsToCheck = [Collections.Generic.List[string]]::new()
    $pathsToCheck.Add($rawRoot)
    $currentPath = $rawRoot
    if ($relativeParent -ne '.') {
        foreach ($segment in $relativeParent.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)) {
            $currentPath = Join-Path $currentPath $segment
            $pathsToCheck.Add($currentPath)
        }
    }
    foreach ($path in $pathsToCheck) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Destination parent contains a reparse point: $path"
            }
        }
    }
}

function Invoke-VerifiedSourceFetch {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$Destination,
        [scriptblock]$DownloadAction = {
            param($Uri, $Path)
            Invoke-WebRequest -Uri $Uri -OutFile $Path -UseBasicParsing
        }
    )

    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https') {
        throw 'Source URL must use HTTPS.'
    }
    if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') {
        throw 'ExpectedSha256 must contain exactly 64 hexadecimal characters.'
    }

    $scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
    $rawRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot 'raw'))
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    Assert-SafeRawDestination -Destination $destinationPath
    if (Test-Path -LiteralPath $destinationPath) {
        throw 'Destination already exists. Source files are immutable; choose a new path.'
    }

    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destinationPath)) -Force | Out-Null
    Assert-SafeRawDestination -Destination $destinationPath
    $temporaryPath = Join-Path $rawRoot ('.download-' + [Guid]::NewGuid().ToString('N'))
    try {
        & $DownloadAction $uri $temporaryPath
        $actualHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) {
            throw "SHA-256 mismatch. Expected $($ExpectedSha256.ToLowerInvariant()); found $actualHash."
        }
        Move-Item -LiteralPath $temporaryPath -Destination $destinationPath
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    if ([string]::IsNullOrWhiteSpace($Url) -or [string]::IsNullOrWhiteSpace($ExpectedSha256) -or [string]::IsNullOrWhiteSpace($Destination)) {
        throw 'Url, ExpectedSha256, and Destination are required.'
    }
    Invoke-VerifiedSourceFetch -Url $Url -ExpectedSha256 $ExpectedSha256 -Destination $Destination
}

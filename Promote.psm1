#Requires -Version 7.2
<#
.SYNOPSIS
    Promotion helper for the SkyMob npm channel (https://npm.skymob.app).

.DESCRIPTION
    Puts a version that GitHub Packages already holds on the public channel, or
    takes one off it.

    The boundary this keeps: the private repositories publish @skymobdev
    packages to GitHub Packages, which only accounts with access to them can
    read; this public repository decides what library authors receive.
    packages.list is that decision, and every function here reads or edits it.

    A promotion downloads the tarball with your own npm access to GitHub
    Packages, checks it is byte for byte the version GitHub Packages published,
    uploads it to this repository's `pool` release and records its hash in
    SHA256SUMS, committed with the packages.list edit. So the only thing that
    crosses from private to public is a person running these commands, git
    carries no tarballs, and CI holds no credential for the private registry.

    Requires Node and npm, with a token for https://npm.pkg.github.com in your
    user-level .npmrc, and the GitHub CLI with write access to this repository.

.EXAMPLE
    Import-Module .\Promote.psm1 -Force

    Get-NpmChannel                                    # listed versions vs. GitHub Packages
    # Quoted: an unquoted @name is splatting to PowerShell.
    New-NpmPromotion    -Package '@skymobdev/sdk' -Version 0.1.8 -Push
    Remove-NpmPromotion -Package '@skymobdev/sdk' -Version 0.1.8 -Push
#>

$script:RepoRoot    = $PSScriptRoot
$script:Repository  = 'SkyMobDev/npm'
$script:Upstream    = 'https://npm.pkg.github.com'
$script:PoolRelease = 'pool'
$script:ListFile    = Join-Path $PSScriptRoot 'packages.list'
$script:HashFile    = Join-Path $PSScriptRoot 'SHA256SUMS'
$script:Utf8        = [System.Text.UTF8Encoding]::new($false)

function Get-NpmChannel {
    <#
    .SYNOPSIS
        Each package packages.list names: its listed versions and its latest on GitHub Packages.
    #>
    [CmdletBinding()]
    param(
        [string] $Package
    )
    $entries = (Read-PackageList).Entries
    $names = if ($Package) { @($Package) } else { @($entries.Name | Sort-Object -Unique) }
    foreach ($name in $names) {
        $listed = @($entries | Where-Object Name -EQ $name | ForEach-Object Version)
        [pscustomobject]@{
            Package  = $name
            Listed   = $listed -join ', '
            Upstream = (Invoke-Npm @('view', $name, 'dist-tags.latest', (Get-ScopeFlag $name))) -join ''
        }
    }
}

function New-NpmPromotion {
    <#
    .SYNOPSIS
        Puts a version GitHub Packages holds on the channel.
    .DESCRIPTION
        Uploads the tarball to the pool release and adds the version to
        packages.list and SHA256SUMS. With -Push, does so on a new branch from
        origin/main and opens the pull request whose merge publishes it;
        without, leaves the two files edited in the working tree.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $Package,
        [Parameter(Mandatory)] [string] $Version,
        [switch] $Push
    )
    $file = Get-TarballName $Package $Version
    $branch = "promote/$($file -replace '\.tgz$', '')"
    if ($Push) { Start-ChannelBranch $branch }
    $list = Read-PackageList
    if ($list.Entries | Where-Object { $_.Name -eq $Package -and $_.Version -eq $Version }) {
        throw "$Package $Version is already listed in packages.list."
    }

    $work = New-TemporaryDirectory
    try {
        $path = Save-UpstreamTarball -Package $Package -Version $Version -Destination $work
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
        if (-not $PSCmdlet.ShouldProcess("$Package $Version ($file, sha256 $hash)", 'Promote')) { return }
        Publish-PoolAsset -Path $path -Hash $hash
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -WhatIf:$false
    }

    $promotedAt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    Write-PackageList $list.Header ($list.Entries + [pscustomobject]@{
        Name = $Package; Version = $Version; PromotedAt = $promotedAt
    })
    $hashes = Read-HashFile
    $hashes[$file] = $hash
    Write-HashFile $hashes

    if ($Push) {
        Submit-ChannelChange -Branch $branch -Title "feat: promote $Package $Version" -Body (
            "Puts ``$Package`` $Version on the channel. ``$file`` is on the ``$script:PoolRelease`` " +
            "release with sha256 ``$hash``, byte for byte the tarball GitHub Packages published.")
    }
}

function Remove-NpmPromotion {
    <#
    .SYNOPSIS
        Takes a version off the channel.
    .DESCRIPTION
        Removes the version from packages.list and SHA256SUMS. Its tarball stays
        on the pool release, so a lock file that names it keeps installing and
        reverting the removal publishes it again.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $Package,
        [Parameter(Mandatory)] [string] $Version,
        [switch] $Push
    )
    $file = Get-TarballName $Package $Version
    $branch = "withdraw/$($file -replace '\.tgz$', '')"
    if ($Push) { Start-ChannelBranch $branch }
    $list = Read-PackageList
    $kept = @($list.Entries | Where-Object { -not ($_.Name -eq $Package -and $_.Version -eq $Version) })
    if ($kept.Count -eq $list.Entries.Count) {
        throw "$Package $Version is not listed in packages.list."
    }
    if (-not $PSCmdlet.ShouldProcess("$Package $Version", 'Remove from the channel')) { return }

    Write-PackageList $list.Header $kept
    $hashes = Read-HashFile
    $hashes.Remove($file)
    Write-HashFile $hashes

    if ($Push) {
        Submit-ChannelChange -Branch $branch -Title "feat: withdraw $Package $Version" -Body (
            "Takes ``$Package`` $Version off the channel. ``$file`` stays on the " +
            "``$script:PoolRelease`` release, so lock files that name it keep installing.")
    }
}

# ── packages.list and SHA256SUMS ────────────────────────────────────────────

function Read-PackageList {
    # The comment block at the top stays as written; the entries below it are
    # rewritten in order by Write-PackageList.
    $lines = [System.IO.File]::ReadAllLines($script:ListFile)
    $header = [System.Collections.Generic.List[string]]::new()
    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($line in $lines) {
        $content = ($line -replace '#.*', '').Trim()
        if ($content -eq '') {
            if ($entries.Count -eq 0) { $header.Add($line) }
            continue
        }
        $fields = $content -split '\s+'
        if ($fields.Count -ne 3) { throw "Malformed packages.list entry: $line" }
        $entries.Add([pscustomobject]@{ Name = $fields[0]; Version = $fields[1]; PromotedAt = $fields[2] })
    }
    while ($header.Count -gt 0 -and $header[-1].Trim() -eq '') { $header.RemoveAt($header.Count - 1) }
    @{ Header = @($header); Entries = @($entries) }
}

function Write-PackageList([string[]] $Header, [object[]] $Entries) {
    # By package, newest version first.
    $ordered = $Entries | Sort-Object -Property Name, @{
        Expression = { [System.Management.Automation.SemanticVersion]::new($_.Version) }; Descending = $true
    }
    $lines = @($Header) + '' + @($ordered | ForEach-Object { "$($_.Name) $($_.Version) $($_.PromotedAt)" })
    [System.IO.File]::WriteAllText($script:ListFile, (($lines -join "`n") + "`n"), $script:Utf8)
}

function Read-HashFile {
    $hashes = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($script:HashFile)) {
        if ($line.Trim() -eq '') { continue }
        if ($line -notmatch '^([0-9a-f]{64})  (\S+\.tgz)$') { throw "Malformed SHA256SUMS line: $line" }
        $hashes[$Matches[2]] = $Matches[1]
    }
    $hashes
}

function Write-HashFile([System.Collections.IDictionary] $Hashes) {
    # Two spaces between hash and name, as sha256sum writes it and as the
    # publish workflow's `sha256sum --strict -c` requires.
    $lines = @($Hashes.Keys | Sort-Object | ForEach-Object { "$($Hashes[$_])  $_" })
    $text = if ($lines.Count -gt 0) { ($lines -join "`n") + "`n" } else { '' }
    [System.IO.File]::WriteAllText($script:HashFile, $text, $script:Utf8)
}

# ── The tarball ─────────────────────────────────────────────────────────────

function Get-TarballName([string] $Package, [string] $Version) {
    # The name `npm pack` gives it: @skymobdev/sdk 0.1.7 is skymobdev-sdk-0.1.7.tgz.
    if ($Package -notmatch '^@[a-z0-9-]+/[a-z0-9._-]+$') { throw "$Package is not a scoped package name." }
    "$($Package.TrimStart('@') -replace '/', '-')-$Version.tgz"
}

function Get-ScopeFlag([string] $Package) {
    # Points the package's scope at GitHub Packages whatever your .npmrc maps it
    # to, so a promotion reads the private registry even on a machine that
    # installs @skymobdev from this channel.
    "--$($Package.Split('/')[0]):registry=$script:Upstream"
}

function Save-UpstreamTarball([string] $Package, [string] $Version, [string] $Destination) {
    $scope = Get-ScopeFlag $Package
    Invoke-Npm @('pack', "$Package@$Version", '--pack-destination', $Destination, $scope, '--loglevel=error') | Out-Null
    $path = Join-Path $Destination (Get-TarballName $Package $Version)
    if (-not (Test-Path -LiteralPath $path)) { throw "npm pack wrote no $(Split-Path $path -Leaf)." }

    $published = (Invoke-Npm @('view', "$Package@$Version", 'dist.integrity', $scope)) -join ''
    $digest = [System.Security.Cryptography.SHA512]::HashData([System.IO.File]::ReadAllBytes($path))
    $integrity = "sha512-$([Convert]::ToBase64String($digest))"
    if ($integrity -ne $published) {
        throw "The downloaded $Package $Version is $integrity, but GitHub Packages published $published."
    }
    $carried = (Invoke-Checked 'node' @((Join-Path $script:RepoRoot 'build-index.mjs'), 'manifest', $path)) -join ''
    if ($carried -ne "$Package $Version") { throw "The tarball of $Package $Version carries $carried." }
    $path
}

function Publish-PoolAsset([string] $Path, [string] $Hash) {
    $name = Split-Path $Path -Leaf
    $view = Invoke-Checked 'gh' @('release', 'view', $script:PoolRelease, '--repo', $script:Repository, '--json', 'assets')
    $assets = @(($view -join "`n" | ConvertFrom-Json).assets)
    if ($assets.name -notcontains $name) {
        Invoke-Checked 'gh' @('release', 'upload', $script:PoolRelease, $Path, '--repo', $script:Repository) | Out-Null
        return
    }
    # A tarball already on the release is reused only when it is the same bytes.
    $work = New-TemporaryDirectory
    try {
        Invoke-Checked 'gh' @('release', 'download', $script:PoolRelease, '--repo', $script:Repository,
            '--pattern', $name, '--dir', $work) | Out-Null
        $existing = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $work $name)).Hash.ToLowerInvariant()
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -WhatIf:$false
    }
    if ($existing -ne $Hash) {
        throw "The $script:PoolRelease release already holds a different $name (sha256 $existing)."
    }
    Write-Verbose "$name is already on the $script:PoolRelease release."
}

# ── git and the pull request ────────────────────────────────────────────────

function Start-ChannelBranch([string] $Branch) {
    $status = Invoke-Checked 'git' @('-C', $script:RepoRoot, 'status', '--porcelain')
    if ($status) { throw "The working tree has changes; commit or stash them first:`n$($status -join "`n")" }
    Invoke-Checked 'git' @('-C', $script:RepoRoot, 'fetch', '--quiet', 'origin', 'main') | Out-Null
    Invoke-Checked 'git' @('-C', $script:RepoRoot, 'switch', '--quiet', '-c', $Branch, 'origin/main') | Out-Null
}

function Submit-ChannelChange([string] $Branch, [string] $Title, [string] $Body) {
    Invoke-Checked 'git' @('-C', $script:RepoRoot, 'add', 'packages.list', 'SHA256SUMS') | Out-Null
    Invoke-Checked 'git' @('-C', $script:RepoRoot, 'commit', '--quiet', '-m', $Title) | Out-Null
    Invoke-Checked 'git' @('-C', $script:RepoRoot, 'push', '--quiet', '-u', 'origin', $Branch) | Out-Null
    Invoke-Checked 'gh' @('pr', 'create', '--repo', $script:Repository, '--base', 'main', '--head', $Branch,
        '--title', $Title, '--body', $Body)
}

# ── Running commands ────────────────────────────────────────────────────────

function Invoke-Npm([string[]] $Arguments) {
    # npm.cmd on Windows: the npm.ps1 shim runs under the execution policy.
    $npm = (Get-Command 'npm' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Invoke-Checked $npm $Arguments
}

function Invoke-Checked([string] $Command, [string[]] $Arguments) {
    # Standard output on success; on failure, everything the command wrote.
    $output = & $Command @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') exited with $LASTEXITCODE`:`n$(($output | Out-String).Trim())"
    }
    @($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
}

function New-TemporaryDirectory {
    $path = Join-Path ([System.IO.Path]::GetTempPath()) "npm-promote-$([Guid]::NewGuid().ToString('N'))"
    # Scratch space even under -WhatIf: the dry run downloads and checks the tarball.
    New-Item -ItemType Directory -Path $path -WhatIf:$false | Out-Null
    $path
}

Export-ModuleMember -Function Get-NpmChannel, New-NpmPromotion, Remove-NpmPromotion

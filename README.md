# SkyMob npm packages

The npm registry for building module libraries for the SkyMob designer, served
at **https://npm.skymob.app** from this repository's GitHub Pages site. Anyone
can install from it: no token, no GitHub account.

| package | what it is |
|---|---|
| `@skymobdev/sdk` | develops, tests and builds a module library |
| `@skymobdev/standard-catalog-types` | the standard catalog's modules, typed for the modules a library builds on them |
| `@skymobdev/cad-mock` | the sample catalog the workbench and tests build modules against |

[`packages.list`](packages.list) names every version served.

## Installing

Point the `@skymobdev` scope here in the project's `.npmrc`:

```ini
@skymobdev:registry=https://npm.skymob.app/
```

With pnpm, a project that holds new versions back (`minimumReleaseAge`)
exempts these packages in `pnpm-workspace.yaml`, so a new SDK release installs
right away:

```yaml
minimumReleaseAgeExclude:
  - "@skymobdev/*"
```

Version ranges, `pnpm update`, `npm outdated` and lock files work as with any
registry. A lock file records each version's tarball URL on the `pool` release.

## Promoting a version

The private repositories publish `@skymobdev` packages to GitHub Packages,
which only accounts with access to them can read. Nothing published there
reaches this registry on its own: what library authors receive is exactly what
`packages.list` names, so promotion is a reviewed edit.
[`Promote.psm1`](Promote.psm1) drives it. It needs PowerShell 7.2, Node with
npm and a token for `https://npm.pkg.github.com` in your user-level `.npmrc`,
and a `gh` with write access to this repository:

```powershell
Import-Module .\Promote.psm1 -Force

Get-NpmChannel                     # listed versions vs. the latest on GitHub Packages
# Quoted: an unquoted @name is splatting to PowerShell.
New-NpmPromotion -Package '@skymobdev/sdk' -Version 0.1.8 -Push
```

`New-NpmPromotion` downloads the tarball with **your** access, refuses it
unless its sha512 is the one GitHub Packages published and its manifest names
that package and version, uploads it to this repository's
[`pool` release](https://github.com/SkyMobDev/npm/releases/tag/pool), and
records its SHA-256 in [`SHA256SUMS`](SHA256SUMS) next to the `packages.list`
entry. With `-Push` it does this on a new branch from `origin/main` and opens
the pull request; merging it publishes. That download is the only crossing from
private to public, and a person makes it: CI holds no credential for GitHub
Packages.

Promote a package's dependencies on other `@skymobdev` packages with it: the
scope resolves here alone, so `@skymobdev/sdk` needs its peer
`@skymobdev/cad-mock` listed too.

Taking a version off is `Remove-NpmPromotion -Package <name> -Version <bad>
-Push`. Its hash leaves `SHA256SUMS` and its tarball stays on the `pool`
release, so lock files that name it keep installing, and reverting the removal
publishes it again. Nothing deletes assets from that release.

## How this repository is published

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) rebuilds the
whole index on each run:

1. tests [`build-index.mjs`](build-index.mjs) (`node --test`),
2. runs [`check-pool.sh`](check-pool.sh): `SHA256SUMS` has to record exactly
   the tarballs `packages.list` names, and every file downloaded from the `pool`
   release has to match its recorded hash,
3. writes each package's index (its "packument": every listed version with the
   manifest from its tarball, the tarball's URL on the `pool` release and its
   sha512) to `@skymobdev/<name>`, the path npm and pnpm request,
4. serves that tree locally and installs the latest of every package at once,
   with npm and with pnpm, then checks each package offers exactly the listed
   versions,
5. deploys it to GitHub Pages, on `main` alone.

A pull request runs steps 1 to 4, so a promotion whose tarball is missing or
does not install fails before the merge.

- **The tarballs live on the `pool` release, not in git.** A promotion adds
  only text to history, and what the review sees is `SHA256SUMS`. Never replace
  or delete an asset on that release by hand: a replaced file fails the hash
  check and stops publishing.
- **A version's publish time is its promotion.** `packages.list` records it,
  and the index gives it to clients, so pnpm's `minimumReleaseAge` counts from
  the day a version reached this registry.
- **No secrets.** The workflow reads this repository's own release with its
  own token.

[`docs/decisions.md`](docs/decisions.md) records why it is built this way.

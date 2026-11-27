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

Yarn 4 reads the scope from `.yarnrc.yml` instead:

```yaml
npmScopes:
  skymobdev:
    npmRegistryServer: "https://npm.skymob.app"
```

Version ranges, `pnpm update`, `npm outdated` and lock files work as with any
registry. A lock file records each version's tarball URL on the `pool` release.

## Publishing a version

The private repositories publish `@skymobdev` packages to GitHub Packages, which only
accounts with access to them can read. Nothing published there reaches this registry
on its own: the **Public release** button in
[SkyMobDev/packages](https://github.com/SkyMobDev/packages/actions/workflows/public-release.yml)
(Actions → public-release → Run workflow) is the only way in. Its list of packages that
go public is hardcoded there. For each chosen version this registry does not list yet, it
downloads the tarball, holds it to the sha512 GitHub Packages published, uploads it to
this repository's [`pool` release](https://github.com/SkyMobDev/npm/releases/tag/pool),
lists it with [`record-version.mjs`](record-version.mjs), and pushes to `main`, which
deploys.

Taking a version off is a pull request:

```sh
node record-version.mjs --remove @skymobdev/sdk 0.1.8
```

Its hash leaves `SHA256SUMS` and its tarball stays on the `pool` release, so lock files
that name it keep installing, and reverting the removal publishes it again. It refuses a
package's last listed version. Nothing deletes assets from that release.

## How this repository is published

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) rebuilds the
whole index on each run:

1. tests [`build-index.mjs`](build-index.mjs) and [`record-version.mjs`](record-version.mjs) (`node --test`),
2. runs [`check-pool.sh`](check-pool.sh): `SHA256SUMS` has to record exactly
   the tarballs `packages.list` names, and every file downloaded from the `pool`
   release has to match its recorded hash,
3. writes each package's index (its "packument": every listed version with the
   manifest from its tarball, the tarball's URL on the `pool` release and its
   sha512) to `@skymobdev/<name>`, the path npm and pnpm request,
4. on `main`, uploads that tree as the Pages artifact,
5. serves it locally and installs the latest of every package at once, with npm
   and with pnpm and with install scripts off, then checks each package offers
   exactly the listed versions,
6. on `main`, deploys the artifact to GitHub Pages.

A pull request runs the checks and the install without uploading or deploying,
so a change whose tarball is missing or does not install fails before the merge.
The artifact is taken before the install, so nothing the install runs reaches
what deploys.

- **The tarballs live on the `pool` release, not in git.** A release adds only
  text to history, and `SHA256SUMS` pins the bytes. Never replace or delete an
  asset on that release by hand: a replaced file fails the hash check and stops
  publishing.
- **A version's publish time is when it was listed here.** `packages.list`
  records it, and the index gives it to clients, so pnpm's `minimumReleaseAge`
  counts from the day a version reached this registry.
- **No secrets.** The workflow reads this repository's own release with its
  own token.

[`docs/decisions.md`](docs/decisions.md) records why it is built this way.

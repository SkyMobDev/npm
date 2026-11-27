# Decisions

How the SkyMob npm registry came to be built the way it is. Each entry has an
ID, a date and a status; the newest change to an entry goes in its own text.

## D1. GitHub hosts the registry, as it hosts the apt channel

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** the registry is static files on this repository's GitHub Pages
  site, with the tarballs as assets of a `pool` release, the way
  [SkyMobDev/apt](https://github.com/SkyMobDev/apt) serves `.deb` files.
- **Why:** module library authors outside the organization need the SDK, and
  GitHub Packages serves npm packages only to accounts with access to the
  private repositories, with a token even for public ones.
- **Rejected:**
  - the public npmjs.com registry: a second publishing credential and account to
    hold, and nothing the static site lacks for installs;
  - a self-hosted registry (Verdaccio): a server to run for files that never
    change once published;
  - tarball URLs in each library's `package.json`: no version ranges, no
    `pnpm update`.
- **Checked** with a placeholder package and npm 11 and pnpm 10: Pages decodes
  the `%2f` of a scoped name to the file's path, serves an extensionless index
  as `application/octet-stream`, which both clients accept, and both follow the
  release asset's redirect. Ranges resolve, lock files record the sha512 and the
  tarball URL, and the index is cached for 10 minutes.

## D2. The packages are public

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** anyone can download `@skymobdev/sdk`,
  `@skymobdev/standard-catalog-types` and `@skymobdev/cad-mock`, so a public
  sample library can be forked and built with no account.

## D3. A person promotes; CI holds no credential

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** `packages.list` and `SHA256SUMS` are the promotion decision.
  `Promote.psm1` downloads a version with the operator's own access, checks its
  sha512 against what GitHub Packages published, uploads it to the `pool`
  release and opens the pull request; the merge publishes.
- **Why:** the same boundary as the apt channel: the private-to-public crossing
  is a person, and publishing a version upstream is a separate decision from
  serving it.

## D4. pnpm's release cooldown exempts the SkyMob packages in the consuming project

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** a library's `pnpm-workspace.yaml` lists `@skymobdev/*` in
  `minimumReleaseAgeExclude`; the SDK README, this README and the landing page
  say so.
- **Why:** pnpm reads each version's publish time from the index and holds back
  one younger than `minimumReleaseAge`, which would keep a library on the
  previous SDK for days after a release.

## D5. The registry is served at npm.skymob.app

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** a CNAME from `npm.skymob.app` to `skymobdev.github.io`, set at
  the DNS provider by the owner; the repository's Pages site carries the custom
  domain and enforces HTTPS.

## Open

- A canary channel, as apt's beta: prereleases are already kept out of
  `latest`, which may be enough.
- Pruning the `pool` release, as apt's `Remove-AptStaleAsset`.

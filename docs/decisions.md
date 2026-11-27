# Decisions

How the SkyMob npm registry came to be built the way it is. Each entry has an
ID, a date and a status; the newest change to an entry goes in its own text.

## D1. GitHub hosts the registry

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** the registry is static files on this repository's GitHub Pages
  site, with the tarballs as assets of a `pool` release.
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

## D3. A Public release button publishes a hardcoded list of packages

- **Date:** 2026-11-27. **Status:** decided.
- **Decision:** the **Public release** workflow in SkyMobDev/packages, started by
  hand, is the only way onto this registry. `PUBLIC_PACKAGES` in its
  `scripts/public-set.mjs` hardcodes what goes public, and a listed package that
  needs an unlisted `@skymobdev` package fails the run. The workflow downloads
  each chosen version from GitHub Packages, holds it to the sha512 published
  there, uploads it to the `pool` release, lists it with `record-version.mjs` and
  pushes to `main`, whose publish workflow checks, test-installs and deploys.
- **Why:**
  - An internal release (every Athena merge that touches the SDK) stays a
    separate decision from a public one.
  - SkyMobDev/packages already reads every `@skymobdev` package with its own token
    and holds the release App, so no credential is added anywhere, and this
    public repository reads no private package.
  - The list is hardcoded so that nothing goes public by being a dependency.
- **Rejected:**
  - a person running a local promotion module (`Promote.psm1`, built first): the
    button does the same without local tools;
  - every internal release opening a promotion pull request: a pull request per
    SDK merge, with conflicting edits to `packages.list`;
  - this repository reading GitHub Packages itself: a grant on each private
    package to a public repository's workflows;
  - computing the public set from the SDK's dependencies: it could publish more
    than intended.

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

- Protecting `main` and the `github-pages` environment: a ruleset that requires
  pull requests on `main` with the release App allowed to push, and deploys from
  `main` alone.
- A canary channel: prereleases are already kept out of `latest`, which may be
  enough.
- Pruning the `pool` release of tarballs no listed version names.

#!/usr/bin/env bash
# Proves the two halves of a promotion agree and leaves the tarballs where
# build-index.mjs reads them: SHA256SUMS records exactly what packages.list
# names, and every file downloaded from the pool release matches its recorded
# hash. It holds no secrets and deploys nothing, so a pull request runs it too.
#
# Needs POOL_RELEASE from the workflow, plus a GH_TOKEN that can read this
# repository's releases. Writes the tarballs to downloads/.
set -euo pipefail

expected=$(mktemp); recorded=$(mktemp)

[ -f packages.list ] || { echo "::error::packages.list is missing"; exit 1; }
while read -r name version promoted rest; do
  case "$name" in '') continue ;; esac
  { [ -n "${promoted:-}" ] && [ -z "${rest:-}" ]; } ||
    { echo "::error::malformed packages.list entry: $name ${version:-} ${promoted:-} ${rest:-}"; exit 1; }
  [[ "$name" =~ ^@[a-z0-9-]+/[a-z0-9._-]+$ ]] ||
    { echo "::error::$name is not a scoped package name"; exit 1; }
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
    { echo "::error::$name $version is not a version"; exit 1; }
  [[ "$promoted" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    { echo "::error::$name $version: $promoted is not a UTC time"; exit 1; }
  # The name `npm pack` gives the tarball: @skymobdev/sdk 0.1.7 is skymobdev-sdk-0.1.7.tgz.
  file="${name#@}"
  echo "${file/\//-}-$version.tgz" >> "$expected"
done < <(sed 's/#.*//; s/\r$//' packages.list)

if sort "$expected" | uniq -d | grep .; then
  echo "::error::packages.list names the versions above twice"
  exit 1
fi
sort -o "$expected" "$expected"

[ -f SHA256SUMS ] || { echo "::error::SHA256SUMS is missing"; exit 1; }
# Two spaces between hash and name, as sha256sum writes it and as the
# `sha256sum --strict -c` below requires.
if grep -v -E '^([0-9a-f]{64}  [^ /]+\.tgz)?$' SHA256SUMS; then
  echo "::error::malformed SHA256SUMS lines above"
  exit 1
fi
awk 'NF { print $2 }' SHA256SUMS | sort > "$recorded"
if ! diff -u --label "named by packages.list" --label "recorded in SHA256SUMS" \
       "$expected" "$recorded"; then
  echo "::error::SHA256SUMS does not record exactly what packages.list names"
  exit 1
fi

mkdir -p downloads
# With no pattern, gh would download every asset on the release.
[ -s "$recorded" ] || { echo "packages.list names no packages"; exit 0; }

# Only the files SHA256SUMS records, each held to its recorded hash: an asset
# replaced on the release without a reviewed change to SHA256SUMS fails here.
patterns=()
while read -r file; do patterns+=(--pattern "$file"); done < "$recorded"
gh release download "$POOL_RELEASE" --repo "$GITHUB_REPOSITORY" --dir downloads "${patterns[@]}"
# Compared by name as well, so a missing asset is reported as the file it is
# rather than as whatever gh makes of an unmatched pattern.
if ! diff -u --label "recorded in SHA256SUMS" --label "downloaded from $POOL_RELEASE" \
       "$recorded" <(ls -1 downloads | sort); then
  echo "::error::the $POOL_RELEASE release is missing files SHA256SUMS records"
  exit 1
fi
(cd downloads && sha256sum --strict -c ../SHA256SUMS)

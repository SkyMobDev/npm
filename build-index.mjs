#!/usr/bin/env node
/**
 * The registry's index: one file per package at `<out>/<@scope>/<name>`, the
 * document npm and pnpm fetch to resolve a version (a "packument"). It lists the
 * versions packages.list names, each with the manifest its tarball carries and
 * where to download it: the pool release, under the name `npm pack` gives it.
 *
 *   node build-index.mjs build <packages.list> <tarball dir> <out dir> <pool url>
 *   node build-index.mjs manifest <file.tgz>     prints the tarball's name and version
 *
 * No dependencies, so the publish workflow and record-version.mjs run it on a bare Node.
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

/** The file `npm pack` writes for a version: `@skymobdev/sdk` 0.1.7 → `skymobdev-sdk-0.1.7.tgz`. */
export const tarballName = (name, version) =>
  `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`

/** The `package/package.json` an npm tarball carries. */
export const readManifest = (bytes) => {
  const tar = gunzipSync(bytes)
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      break
    }
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0[\s\S]*$/, "")
    // A POSIX ustar header splits a long path into a prefix and a name. A GNU header
    // ("ustar  ") keeps other fields at that offset.
    const ustar = header.subarray(257, 263).toString("latin1") === "ustar\0"
    const prefix = ustar ? field(345, 155) : ""
    const path = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
    const size = parseInt(field(124, 12).trim() || "0", 8)
    const body = offset + 512
    if (path === "package/package.json") {
      return JSON.parse(tar.subarray(body, body + size).toString("utf8"))
    }
    offset = body + Math.ceil(size / 512) * 512
  }
  throw new Error("the tarball carries no package/package.json")
}

/** Semantic version precedence: negative when `a` comes before `b`. */
export const compareVersions = (a, b) => {
  const split = (version) => {
    const plain = version.split("+")[0]
    const dash = plain.indexOf("-")
    const core = (dash < 0 ? plain : plain.slice(0, dash)).split(".").map(Number)
    return [core, dash < 0 ? [] : plain.slice(dash + 1).split(".")]
  }
  const [coreA, preA] = split(a)
  const [coreB, preB] = split(b)
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) {
      return coreA[i] - coreB[i]
    }
  }
  // A release comes after its prereleases.
  if (preA.length === 0 || preB.length === 0) {
    return preB.length - preA.length
  }
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    if (i >= preA.length) {
      return -1
    }
    if (i >= preB.length) {
      return 1
    }
    const [x, y] = [preA[i], preB[i]]
    const [numericX, numericY] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (numericX && numericY && Number(x) !== Number(y)) {
      return Number(x) - Number(y)
    }
    if (numericX !== numericY) {
      return numericX ? -1 : 1
    }
    if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

const isPrerelease = (version) => version.split("+")[0].includes("-")

/**
 * packages.list as written: the comment block above the first entry, the entries
 * (`<package> <version> <promoted-at>`, each with the comment on its line), and the
 * comment lines below the first entry.
 */
export const parseList = (text) => {
  const header = []
  const entries = []
  const trailer = []
  for (const line of text.replace(/\r?\n$/, "").split(/\r?\n/)) {
    const hash = line.indexOf("#")
    const content = (hash < 0 ? line : line.slice(0, hash)).trim()
    if (content === "") {
      ;(entries.length === 0 ? header : trailer).push(line)
      continue
    }
    const fields = content.split(/\s+/)
    if (fields.length !== 3) {
      throw new Error(`malformed packages.list entry: ${line}`)
    }
    const [name, version, promotedAt] = fields
    entries.push({ name, version, promotedAt, comment: hash < 0 ? "" : line.slice(hash) })
  }
  return { header, entries, trailer }
}

/** The entries of packages.list. */
export const readList = (text) => parseList(text).entries

/**
 * Each package's packument, keyed by package name. `latest` is the highest
 * release, or the highest prerelease while a package has no release; a version
 * range skips prereleases either way. A version's `time` is its promotion, which
 * pnpm's `minimumReleaseAge` counts from.
 */
export const buildIndex = (entries, readTarball, poolUrl) => {
  const packages = new Map()
  for (const { name, version, promotedAt } of entries) {
    const file = tarballName(name, version)
    const bytes = readTarball(file)
    const manifest = readManifest(bytes)
    // The filename is not the version: the index serves what the tarball says.
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`${file} carries ${manifest.name}@${manifest.version}`)
    }
    const versions = packages.get(name) ?? new Map()
    packages.set(name, versions)
    if (versions.has(version)) {
      throw new Error(`${name} ${version} is listed twice`)
    }
    versions.set(version, {
      promotedAt,
      manifest: {
        ...manifest,
        _id: `${name}@${version}`,
        dist: {
          tarball: `${poolUrl}${file}`,
          shasum: createHash("sha1").update(bytes).digest("hex"),
          integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        },
      },
    })
  }
  return new Map(
    [...packages].map(([name, versions]) => {
      const ordered = [...versions.keys()].sort(compareVersions)
      const releases = ordered.filter((version) => !isPrerelease(version))
      const latest = (releases.length > 0 ? releases : ordered).at(-1)
      const promoted = ordered.map((version) => versions.get(version).promotedAt).sort()
      return [
        name,
        {
          _id: name,
          name,
          description: versions.get(latest).manifest.description,
          "dist-tags": { latest },
          versions: Object.fromEntries(
            ordered.map((version) => [version, versions.get(version).manifest])
          ),
          time: {
            created: promoted[0],
            modified: promoted.at(-1),
            ...Object.fromEntries(
              ordered.map((version) => [version, versions.get(version).promotedAt])
            ),
          },
        },
      ]
    })
  )
}

const main = ([command, ...args]) => {
  if (command === "manifest" && args.length === 1) {
    const { name, version } = readManifest(readFileSync(args[0]))
    process.stdout.write(`${name} ${version}\n`)
    return
  }
  if (command === "build" && args.length === 4) {
    const [listFile, tarballDir, outDir, poolUrl] = args
    const index = buildIndex(
      readList(readFileSync(listFile, "utf8")),
      (file) => readFileSync(join(tarballDir, file)),
      poolUrl
    )
    for (const [name, packument] of index) {
      const target = join(outDir, name)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `${JSON.stringify(packument, null, 2)}\n`)
      console.log(`${name}: ${Object.keys(packument.versions).join(", ")} (latest ${packument["dist-tags"].latest})`)
    }
    return
  }
  console.error(
    "usage: node build-index.mjs build <packages.list> <tarball dir> <out dir> <pool url>\n" +
      "       node build-index.mjs manifest <file.tgz>"
  )
  process.exit(2)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}

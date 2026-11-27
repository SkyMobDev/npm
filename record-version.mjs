#!/usr/bin/env node
/**
 * Edits packages.list and SHA256SUMS, the record of what the registry serves:
 *
 *   node record-version.mjs <file.tgz>...              lists each tarball's version
 *   node record-version.mjs --remove <name> <version>  takes a version off
 *
 * The Public release workflow in SkyMobDev/packages lists versions with it, after
 * uploading their tarballs to the pool release; a withdrawal is a pull request
 * made with --remove. A version already listed with the same tarball stays as it
 * is; with another tarball, it fails. Runs in this repository's root.
 */

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { compareVersions, parseList, readManifest, tarballName } from "./build-index.mjs"

const LIST_FILE = "packages.list"
const SUMS_FILE = "SHA256SUMS"

/** SHA256SUMS as a map from tarball name to hash. */
export const parseSums = (text) =>
  new Map(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const match = /^([0-9a-f]{64}) {2}(\S+\.tgz)$/.exec(line)
        if (match === null) {
          throw new Error(`malformed SHA256SUMS line: ${line}`)
        }
        return [match[2], match[1]]
      })
  )

/** The entries by package, newest version first, between the comments as written. */
export const formatList = ({ header, entries, trailer }) => {
  const ordered = [...entries].sort((a, b) =>
    a.name === b.name ? compareVersions(b.version, a.version) : a.name < b.name ? -1 : 1
  )
  const lines = ordered.map(({ name, version, promotedAt, comment }) =>
    [name, version, promotedAt, comment].filter((field) => field !== "").join(" ")
  )
  const head = [...header]
  while (head.length > 0 && head.at(-1).trim() === "") {
    head.pop()
  }
  return `${[...head, "", ...lines, ...trailer].join("\n")}\n`
}

/** Two spaces between hash and name, as sha256sum writes it and `sha256sum --strict -c` reads it. */
export const formatSums = (sums) =>
  [...sums.keys()]
    .sort()
    .map((file) => `${sums.get(file)}  ${file}\n`)
    .join("")

/** The time a version is listed, to the second: what the index gives clients as its publish time. */
export const promotionTime = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z")

/** Lists a tarball's version in `record` (the parsed list and sums); says whether it was new. */
export const addVersion = (record, bytes, promotedAt) => {
  const { name, version } = readManifest(bytes)
  const file = tarballName(name, version)
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (record.entries.some((entry) => entry.name === name && entry.version === version)) {
    if (record.sums.get(file) !== hash) {
      throw new Error(`${name} ${version} is already listed with another tarball`)
    }
    return { name, version, added: false }
  }
  if (record.sums.has(file)) {
    throw new Error(`SHA256SUMS records ${file}, which packages.list does not name`)
  }
  record.entries.push({ name, version, promotedAt, comment: "" })
  record.sums.set(file, hash)
  return { name, version, added: true }
}

/**
 * Takes a version off. Refuses a package's last listed version: a range would stop
 * resolving for every library that installs it, so that is a deliberate edit by hand.
 */
export const removeVersion = (record, name, version) => {
  const listed = record.entries.filter((entry) => entry.name === name)
  if (!listed.some((entry) => entry.version === version)) {
    throw new Error(`${name} ${version} is not listed`)
  }
  if (listed.length === 1) {
    throw new Error(`${version} is the only listed version of ${name}`)
  }
  record.entries = record.entries.filter((entry) => !(entry.name === name && entry.version === version))
  record.sums.delete(tarballName(name, version))
}

const main = (args) => {
  const record = {
    ...parseList(readFileSync(LIST_FILE, "utf8")),
    sums: parseSums(readFileSync(SUMS_FILE, "utf8")),
  }
  if (args[0] === "--remove" && args.length === 3) {
    removeVersion(record, args[1], args[2])
    console.log(`removed ${args[1]} ${args[2]}`)
  } else if (args.length > 0 && args.every((arg) => arg.endsWith(".tgz"))) {
    const promotedAt = promotionTime(new Date())
    for (const file of args) {
      const { name, version, added } = addVersion(record, readFileSync(file), promotedAt)
      console.log(`${added ? "listed" : "already listed"} ${name} ${version}`)
    }
  } else {
    console.error(
      "usage: node record-version.mjs <file.tgz>...\n" +
        "       node record-version.mjs --remove <name> <version>"
    )
    process.exit(2)
  }
  writeFileSync(LIST_FILE, formatList(record))
  writeFileSync(SUMS_FILE, formatSums(record.sums))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}

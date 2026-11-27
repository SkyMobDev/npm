import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { parseList } from "./build-index.mjs"
import {
  addVersion,
  formatList,
  formatSums,
  parseSums,
  promotionTime,
  removeVersion,
} from "./record-version.mjs"
import { pack } from "./tarball-fixture.mjs"

const LIST = [
  "# What the registry serves.",
  "#",
  "",
  "@skymobdev/sdk 0.1.7 2026-11-20T12:00:00Z  # the first public SDK",
  "# a note between entries",
  "@skymobdev/cad-mock 0.1.71 2026-11-20T12:00:00Z",
  "",
].join("\n")

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const sdk = (version) => pack({ name: "@skymobdev/sdk", version })
const recordOf = (list, sums) => ({ ...parseList(list), sums: parseSums(sums) })
const SUMS = `${sha256(sdk("0.1.7"))}  skymobdev-sdk-0.1.7.tgz\n${"a".repeat(64)}  skymobdev-cad-mock-0.1.71.tgz\n`

test("a new version is listed in order, with its hash, and the comments stay", () => {
  const record = recordOf(LIST, SUMS)
  assert.deepEqual(addVersion(record, sdk("0.1.12"), "2026-11-27T18:00:00Z"), {
    name: "@skymobdev/sdk",
    version: "0.1.12",
    added: true,
  })
  assert.equal(
    formatList(record),
    [
      "# What the registry serves.",
      "#",
      "",
      "@skymobdev/cad-mock 0.1.71 2026-11-20T12:00:00Z",
      "@skymobdev/sdk 0.1.12 2026-11-27T18:00:00Z",
      "@skymobdev/sdk 0.1.7 2026-11-20T12:00:00Z # the first public SDK",
      "# a note between entries",
      "",
    ].join("\n")
  )
  assert.equal(
    formatSums(record.sums),
    `${"a".repeat(64)}  skymobdev-cad-mock-0.1.71.tgz\n` +
      `${sha256(sdk("0.1.12"))}  skymobdev-sdk-0.1.12.tgz\n` +
      `${sha256(sdk("0.1.7"))}  skymobdev-sdk-0.1.7.tgz\n`
  )
  // A written file reads back to itself.
  assert.equal(formatList(parseList(formatList(record))), formatList(record))
})

test("a listed version stays listed with the same tarball, and fails with another", () => {
  const record = recordOf(LIST, SUMS)
  assert.deepEqual(addVersion(record, sdk("0.1.7"), "2026-11-27T18:00:00Z"), {
    name: "@skymobdev/sdk",
    version: "0.1.7",
    added: false,
  })
  assert.equal(record.entries.length, 2)
  const rebuilt = pack({ name: "@skymobdev/sdk", version: "0.1.7", description: "rebuilt" })
  assert.throws(() => addVersion(record, rebuilt, "2026-11-27T18:00:00Z"), /already listed with another tarball/)
  const stray = recordOf(LIST, `${SUMS}${"b".repeat(64)}  skymobdev-sdk-0.1.9.tgz\n`)
  assert.throws(() => addVersion(stray, sdk("0.1.9"), "2026-11-27T18:00:00Z"), /SHA256SUMS records skymobdev-sdk-0\.1\.9\.tgz/)
})

test("removing a version takes its entry and hash, and refuses a package's last version", () => {
  const record = recordOf(LIST, SUMS)
  addVersion(record, sdk("0.1.12"), "2026-11-27T18:00:00Z")
  removeVersion(record, "@skymobdev/sdk", "0.1.12")
  assert.deepEqual(
    record.entries.map(({ name, version }) => `${name} ${version}`),
    ["@skymobdev/sdk 0.1.7", "@skymobdev/cad-mock 0.1.71"]
  )
  assert.equal(record.sums.has("skymobdev-sdk-0.1.12.tgz"), false)
  assert.throws(() => removeVersion(record, "@skymobdev/sdk", "0.1.12"), /is not listed/)
  assert.throws(() => removeVersion(record, "@skymobdev/cad-mock", "0.1.71"), /only listed version/)
  assert.throws(() => parseSums("abc  file.tgz\n"), /malformed SHA256SUMS line/)
})

test("the promotion time is UTC to the second", () => {
  assert.equal(promotionTime(new Date(Date.UTC(2026, 10, 27, 18, 5, 9, 123))), "2026-11-27T18:05:09Z")
})

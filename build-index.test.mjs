import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { gzipSync } from "node:zlib"
import { buildIndex, compareVersions, readList, readManifest, tarballName } from "./build-index.mjs"

/** An npm tarball holding only `package/package.json`, as a one-entry ustar archive. */
const pack = (manifest) => {
  const body = Buffer.from(JSON.stringify(manifest))
  const header = Buffer.alloc(512)
  const put = (text, offset) => header.write(text, offset, "ascii")
  put("package/package.json", 0)
  put("0000644\0", 100)
  put(`${body.length.toString(8).padStart(11, "0")}\0`, 124)
  put("0\0", 156)
  put("ustar\0", 257)
  put("00", 263)
  header.fill(" ", 148, 156)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  put(`${checksum.toString(8).padStart(6, "0")}\0 `, 148)
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]))
}

const POOL = "https://github.com/SkyMobDev/npm/releases/download/pool/"

test("the index lists each version with its manifest, tarball and hashes", () => {
  const tarballs = new Map()
  const add = (version, extra = {}) => {
    const manifest = { name: "@skymobdev/sdk", version, description: `sdk ${version}`, ...extra }
    tarballs.set(tarballName("@skymobdev/sdk", version), pack(manifest))
  }
  add("0.1.9")
  add("0.1.10", { peerDependencies: { three: ">=0.187.0" } })
  add("0.2.0-beta.1")
  tarballs.set(tarballName("@skymobdev/cad-mock", "0.1.71"), pack({ name: "@skymobdev/cad-mock", version: "0.1.71" }))

  const entries = readList(
    [
      "# a comment",
      "@skymobdev/sdk 0.2.0-beta.1 2026-11-27T12:00:00Z",
      "@skymobdev/sdk 0.1.9 2026-11-20T12:00:00Z  # trailing comment",
      "@skymobdev/sdk 0.1.10 2026-11-25T12:00:00Z",
      "",
      "@skymobdev/cad-mock 0.1.71 2026-11-26T12:00:00Z",
    ].join("\r\n")
  )
  const index = buildIndex(entries, (file) => tarballs.get(file), POOL)

  assert.deepEqual([...index.keys()], ["@skymobdev/sdk", "@skymobdev/cad-mock"])
  const sdk = index.get("@skymobdev/sdk")
  assert.deepEqual(Object.keys(sdk.versions), ["0.1.9", "0.1.10", "0.2.0-beta.1"])
  // `latest` is the highest release: a prerelease never becomes the default.
  assert.deepEqual(sdk["dist-tags"], { latest: "0.1.10" })
  assert.equal(sdk.description, "sdk 0.1.10")

  const bytes = tarballs.get("skymobdev-sdk-0.1.10.tgz")
  assert.deepEqual(sdk.versions["0.1.10"], {
    name: "@skymobdev/sdk",
    version: "0.1.10",
    description: "sdk 0.1.10",
    peerDependencies: { three: ">=0.187.0" },
    _id: "@skymobdev/sdk@0.1.10",
    dist: {
      tarball: `${POOL}skymobdev-sdk-0.1.10.tgz`,
      shasum: createHash("sha1").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    },
  })
  assert.deepEqual(sdk.time, {
    created: "2026-11-20T12:00:00Z",
    modified: "2026-11-27T12:00:00Z",
    "0.1.9": "2026-11-20T12:00:00Z",
    "0.1.10": "2026-11-25T12:00:00Z",
    "0.2.0-beta.1": "2026-11-27T12:00:00Z",
  })
})

test("a package with only prereleases has its highest prerelease as latest", () => {
  const tarballs = new Map(
    ["0.1.0-beta.2", "0.1.0-beta.10"].map((version) => [
      tarballName("@skymobdev/sdk", version),
      pack({ name: "@skymobdev/sdk", version }),
    ])
  )
  const entries = readList(
    "@skymobdev/sdk 0.1.0-beta.2 2026-11-27T12:00:00Z\n@skymobdev/sdk 0.1.0-beta.10 2026-11-27T12:00:00Z\n"
  )
  const sdk = buildIndex(entries, (file) => tarballs.get(file), POOL).get("@skymobdev/sdk")
  assert.deepEqual(sdk["dist-tags"], { latest: "0.1.0-beta.10" })
})

test("an entry fails when its tarball carries another version, or it is listed twice", () => {
  const renamed = new Map([["skymobdev-sdk-0.1.8.tgz", pack({ name: "@skymobdev/sdk", version: "0.1.7" })]])
  assert.throws(
    () => buildIndex(readList("@skymobdev/sdk 0.1.8 2026-11-27T12:00:00Z"), (file) => renamed.get(file), POOL),
    /skymobdev-sdk-0\.1\.8\.tgz carries @skymobdev\/sdk@0\.1\.7/
  )
  const tarball = pack({ name: "@skymobdev/sdk", version: "0.1.7" })
  const twice = readList("@skymobdev/sdk 0.1.7 2026-11-27T12:00:00Z\n@skymobdev/sdk 0.1.7 2026-11-28T12:00:00Z")
  assert.throws(() => buildIndex(twice, () => tarball, POOL), /listed twice/)
  assert.throws(() => readList("@skymobdev/sdk 0.1.7"), /malformed packages\.list entry/)
})

test("versions order by semantic version precedence", () => {
  // The precedence example of the semver specification, section 11.
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.10.0",
  ]
  assert.deepEqual([...ordered].reverse().sort(compareVersions), ordered)
  assert.equal(readManifest(pack({ name: "a", version: "1.0.0" })).version, "1.0.0")
})

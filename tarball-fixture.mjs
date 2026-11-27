import { gzipSync } from "node:zlib"

/** An npm tarball holding only `package/package.json`, as a one-entry ustar archive. */
export const pack = (manifest) => {
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

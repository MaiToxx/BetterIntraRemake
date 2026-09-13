/**
 * Write updates.xml (Chrome self-hosted update manifest) for a release.
 *
 *   node scripts/update-updates-xml.js 1.8.12
 *
 * The extension id is derived from the public half of the CRX signing key
 * (scripts/crx-public-key.b64: SHA-256 of the SPKI DER, first 32 hex digits
 * mapped to a-p), the .crx URL from package.json "repository". The private
 * key is the CRX_PRIVATE_KEY repository secret. Chrome only honours
 * update_url for extensions installed from a .crx (Linux); the Chrome Web
 * Store is the only update channel on Windows and macOS.
 *
 * The key is deliberately NOT put in the manifest's "key" field: that would
 * change the id of existing unpacked installs and lose their local settings.
 */
import fs from "fs";
import crypto from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readRepoInfo } from "./repo-info.js";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/update-updates-xml.js <x.y.z>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicKey = fs
  .readFileSync(resolve(root, "scripts/crx-public-key.b64"), "utf8")
  .trim();
if (!publicKey) {
  console.error("scripts/crx-public-key.b64 is missing or empty");
  process.exit(1);
}

export function extensionIdFromKey(keyB64) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(keyB64, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

const repo = readRepoInfo();
const appId = extensionIdFromKey(publicKey);
const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${appId}'>
    <updatecheck codebase='${repo.crxUrl(version)}' version='${version}' />
  </app>
</gupdate>
`;
fs.writeFileSync(resolve(root, "updates.xml"), xml);
console.log(`updates.xml: ${appId} -> v${version}`);

/**
 * Fetches the signed .xpi of an add-on version already submitted to
 * addons.mozilla.org, once Mozilla has approved it.
 *
 *   AMO_KEY=... AMO_SECRET=... node scripts/amo-signed-xpi.mjs 1.14.1 better-intra.xpi
 *
 * Exit codes: 0 downloaded; 3 still waiting for Mozilla (awaiting review);
 * 4 refused or disabled on AMO; 2 no such version (never submitted); 1 error.
 *
 * Why: publish.yaml submits the version and waits for approval, but AMO can
 * hold an update for a manual review that lasts hours or days (1.14.0 and
 * 1.14.1 did). finish-release.yaml runs this every half hour instead, so the
 * release completes by itself whenever Mozilla approves it.
 *
 * Same API and authentication as web-ext (lib/util/submit-addon.js): a JWT
 * signed with the API secret (HS256, issuer = API key), sent as
 * "Authorization: JWT <token>" to every request, the file download included.
 */
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const AMO_API = "https://addons.mozilla.org/api/v5/";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A short-lived AMO API token (JWT HS256, issuer = key). */
export function amoToken(key, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: key, jti: randomUUID(), iat: nowSec, exp: nowSec + 60 }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * The state of `version` of the add-on `guid` on AMO:
 * { state: "signed", url } | { state: "waiting", status } | { state: "refused", status } | { state: "missing" }.
 * `fetchImpl` and the token maker are injectable for tests.
 */
export async function versionState({ guid, version, key, secret, fetchImpl = fetch }) {
  const auth = () => ({
    Authorization: `JWT ${amoToken(key, secret)}`,
    Accept: "application/json",
  });
  let url = new URL(`addons/addon/${encodeURIComponent(guid)}/versions/?filter=all_with_unlisted&page_size=50`, AMO_API);
  for (let page = 0; page < 10 && url; page++) {
    const res = await fetchImpl(url, { headers: auth() });
    if (res.status === 404) return { state: "missing" };
    if (!res.ok) throw new Error(`AMO answered ${res.status} for the version list`);
    const data = await res.json();
    const hit = (data.results ?? []).find((v) => v && v.version === version);
    if (hit) {
      const file = hit.file ?? {};
      if (file.status === "public" && typeof file.url === "string") return { state: "signed", url: file.url };
      if (file.status === "disabled" || hit.is_disabled === true) return { state: "refused", status: file.status ?? "disabled" };
      return { state: "waiting", status: file.status ?? "unknown" };
    }
    url = data.next ? new URL(data.next) : null;
  }
  return { state: "missing" };
}

/** Downloads a signed file (AMO wants the JWT on the download too). */
export async function downloadSigned({ url, key, secret, fetchImpl = fetch }) {
  const res = await fetchImpl(new URL(url), {
    headers: { Authorization: `JWT ${amoToken(key, secret)}` },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const [version, out = "better-intra.xpi"] = process.argv.slice(2);
  const key = process.env.AMO_KEY;
  const secret = process.env.AMO_SECRET;
  if (!version || !key || !secret) {
    console.error("usage: AMO_KEY=... AMO_SECRET=... node scripts/amo-signed-xpi.mjs <version> [out.xpi]");
    process.exit(1);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { readFileSync } = await import("node:fs");
  const updates = JSON.parse(readFileSync(resolve(root, "updates.json"), "utf8"));
  const guid = Object.keys(updates.addons)[0];
  const state = await versionState({ guid, version, key, secret });
  if (state.state === "signed") {
    writeFileSync(out, await downloadSigned({ url: state.url, key, secret }));
    console.log(`signed ${version} downloaded to ${out}`);
    process.exit(0);
  }
  if (state.state === "waiting") {
    console.log(`${version} is still waiting for Mozilla (file status: ${state.status})`);
    process.exit(3);
  }
  if (state.state === "refused") {
    console.log(`${version} was refused or disabled on AMO (file status: ${state.status}): see the add-on's page on addons.mozilla.org`);
    process.exit(4);
  }
  console.log(`${version} was never submitted to AMO`);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}

// Where the sealed vote records are kept after the election ends.
//
// A storage object has put(name, text), and (for local storage only) get(name) and exists(name).
//   "local"   writes files into a folder. Stands in for the bucket while building and testing.
//   "oracle"  uploads to a PRIVATE Oracle Cloud Object Storage bucket through a write-only
//             pre-authenticated link (PAR). The server holds no Oracle login or key: the link can
//             create objects but cannot list, read or delete anything. The admin downloads the file
//             from the Oracle console with their own login.
const fs = require("node:fs");
const path = require("node:path");

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const checkName = (name) => {
  if (!SAFE_NAME.test(name) || name.includes("..")) throw new Error("Invalid storage object name.");
  return name;
};

function localStorageDir(dir) {
  const root = path.resolve(dir);
  const file = (name) => path.join(root, checkName(name));
  return {
    kind: "local",
    location: root,
    async put(name, text) {
      fs.mkdirSync(root, { recursive: true });
      // Write to a temp file first so a reader never sees half a file.
      const tmp = file(name) + ".tmp";
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file(name));
    },
    async get(name) {
      return fs.readFileSync(file(name), "utf8");
    },
    async exists(name) {
      return fs.existsSync(file(name));
    },
  };
}

/**
 * Oracle Object Storage through a bucket-level pre-authenticated request that permits object WRITES.
 * Its URL looks like  https://objectstorage.<region>.oraclecloud.com/p/<secret>/n/<namespace>/b/<bucket>/o/
 * The URL is a secret: it is never logged and never put in an error message.
 */
function oracleParStorage({ parUrl, fetchImpl = globalThis.fetch, timeoutMs = 30_000, allowAnyHost = false }) {
  let u;
  try {
    u = new URL(String(parUrl));
  } catch {
    throw new Error("STORAGE_PAR_URL is not a valid web address.");
  }
  if (u.protocol !== "https:" && !(allowAnyHost && u.protocol === "http:")) throw new Error("STORAGE_PAR_URL must start with https://.");
  if (!allowAnyHost && !u.hostname.endsWith(".oraclecloud.com")) throw new Error("STORAGE_PAR_URL must be an oraclecloud.com address.");
  const m = u.pathname.match(/^\/p\/[^/]+\/n\/[^/]+\/b\/[^/]+\/o\/(.*)$/);
  if (!m) throw new Error("STORAGE_PAR_URL must be a write link for a bucket or for one object (it contains /o/).");
  // A link for ONE object (best: a stolen link can write only that file) or for the whole bucket.
  const fixedObject = m[1] ? decodeURIComponent(m[1]) : null;
  const base = u.origin + u.pathname.replace(/\/?$/, "/");

  return {
    kind: "oracle",
    location: "Oracle Object Storage (private bucket, write-only link)",
    fixedObject, // the one file name this link allows, or null for a bucket-wide link
    async put(name, text) {
      checkName(name);
      if (fixedObject && fixedObject !== name) {
        throw new Error(`This link only allows writing the object "${fixedObject}", not "${name}".`);
      }
      let res;
      try {
        res = await fetchImpl(fixedObject ? u.origin + u.pathname : base + encodeURIComponent(name), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: text,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("Could not reach Oracle Object Storage.");
      }
      if (!res.ok) throw new Error(`Oracle Object Storage refused the upload (HTTP ${res.status}).`);
    },
  };
}

function createStorage({ type = "local", dir = "data/cloud-storage", parUrl = "", ...options } = {}) {
  if (type === "local") return localStorageDir(dir);
  if (type === "oracle") return oracleParStorage({ parUrl, ...options });
  throw new Error(`Unknown storage type "${type}". Use "local" or "oracle".`);
}

module.exports = { createStorage };

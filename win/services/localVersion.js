const fs = require("fs");
const crypto = require("crypto");
const {
  resolveSoundSenseVersionDir,
  resolveSoundSenseVersionFile,
} = require("./pathUtils");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readLocalVersion() {
  const versionPath = resolveSoundSenseVersionFile();
  try {
    const raw = fs.readFileSync(versionPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalVersion(versionData) {
  ensureDir(resolveSoundSenseVersionDir());
  fs.writeFileSync(
    resolveSoundSenseVersionFile(),
    JSON.stringify(versionData, null, 2),
    "utf-8"
  );
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

module.exports = {
  readLocalVersion,
  writeLocalVersion,
  hashFile,
};

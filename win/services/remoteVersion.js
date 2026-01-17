const https = require("https");
const fs = require("fs");
const path = require("path");

const REMOTE_BASE_URL = "https://soundsense.pro/builds/windows/SoundSense";
const REMOTE_VERSION_URL = `${REMOTE_BASE_URL}/version/version_files.json`;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(`HTTP ${res.statusCode} while requesting ${url}`)
          );
          res.resume();
          return;
        }

        res.setEncoding("utf8");
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function streamFile(url, destination) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(`HTTP ${res.statusCode} while downloading ${url}`)
          );
          res.resume();
          return;
        }

        const tmpPath = `${destination}.download`;
        const fileStream = fs.createWriteStream(tmpPath);

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => {
            fs.rename(tmpPath, destination, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(destination);
              }
            });
          });
        });

        fileStream.on("error", (err) => {
          fs.rm(tmpPath, { force: true }, () => reject(err));
        });
      })
      .on("error", reject);
  });
}

async function fetchRemoteVersion() {
  return fetchJson(REMOTE_VERSION_URL);
}

async function downloadRemoteFile(relativePath, destinationPath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const url = `${REMOTE_BASE_URL}/${normalized}`;
  ensureDir(path.dirname(destinationPath));
  await streamFile(url, destinationPath);
  return destinationPath;
}

module.exports = {
  REMOTE_BASE_URL,
  REMOTE_VERSION_URL,
  fetchRemoteVersion,
  downloadRemoteFile,
};

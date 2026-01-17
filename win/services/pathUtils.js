const path = require("path");
const { app } = require("electron");

function getLauncherRoot() {
  if (app && typeof app.isPackaged === "function" && app.isPackaged) {
    const exeDir = app.getPath("exe");
    return path.dirname(exeDir);
  }

  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }

  return process.cwd();
}

function resolveGamesDir() {
  return path.join(getLauncherRoot(), "Games");
}

function resolveSoundSenseDir() {
  return path.join(resolveGamesDir(), "SoundSense");
}

function resolveSoundSenseVersionDir() {
  return path.join(resolveSoundSenseDir(), "version");
}

function resolveSoundSenseVersionFile() {
  return path.join(resolveSoundSenseVersionDir(), "version_files.json");
}

function resolveSoundSenseExecutable() {
  return path.join(resolveSoundSenseDir(), "SSUT.exe");
}

function resolveSoundSenseFile(relativePath) {
  return path.join(resolveSoundSenseDir(), relativePath);
}

module.exports = {
  getLauncherRoot,
  resolveGamesDir,
  resolveSoundSenseDir,
  resolveSoundSenseVersionDir,
  resolveSoundSenseVersionFile,
  resolveSoundSenseExecutable,
  resolveSoundSenseFile,
};

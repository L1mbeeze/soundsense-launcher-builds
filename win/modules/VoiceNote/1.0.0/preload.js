const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");

function readConfig() {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeConfig(data) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (error) {
    return false;
  }
}

contextBridge.exposeInMainWorld("voiceNoteConfig", {
  readConfig,
  writeConfig,
});

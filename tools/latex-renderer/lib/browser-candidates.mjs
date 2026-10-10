import fs from "node:fs";
import path from "node:path";

export function resolveLocalBrowserPath() {
  const candidates = [
    process.env.CLASSROOM_TOOLKIT_BROWSER_PATH,
    path.join(process.env.LOCALAPPDATA ?? "", "Chromium", "Application", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

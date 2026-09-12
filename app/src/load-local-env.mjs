import fs from "node:fs/promises";

const ALLOWED_KEYS = new Set([
  "MODEL_ROUTER_API_KEY",
  "MODEL_ROUTER_BASE_URL",
  "MODEL_ROUTER_MODEL",
  "MODEL_ROUTER_FALLBACK_MODEL",
  "MODEL_ROUTER_APP_USE_APPROVED",
  "HOST",
  "PORT"
]);

export async function loadLocalEnv(fileUrl) {
  try {
    const content = await fs.readFile(fileUrl, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      if (!ALLOWED_KEYS.has(key) || process.env[key]) continue;
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) process.env[key] = value;
    }
    return { loaded: true, allowedKeys: [...ALLOWED_KEYS] };
  } catch (error) {
    if (error.code === "ENOENT") return { loaded: false, reason: "not-found" };
    throw error;
  }
}

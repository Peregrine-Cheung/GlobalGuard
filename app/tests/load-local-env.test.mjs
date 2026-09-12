import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/load-local-env.mjs";

test("local env loader reads only allowlisted keys and does not overwrite process values", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "globalguard-env-"));
  const file = path.join(directory, ".env.local");
  const originalPort = process.env.PORT;
  const originalKey = process.env.MODEL_ROUTER_API_KEY;
  process.env.PORT = "9999";
  delete process.env.MODEL_ROUTER_API_KEY;
  await fs.writeFile(file, [
    "MODEL_ROUTER_API_KEY=test-only-placeholder",
    "PORT=4000",
    "UNSAFE_KEY=must-not-load"
  ].join("\n"));

  try {
    const result = await loadLocalEnv(pathToFileURL(file));
    assert.equal(result.loaded, true);
    assert.equal(process.env.MODEL_ROUTER_API_KEY, "test-only-placeholder");
    assert.equal(process.env.PORT, "9999");
    assert.equal(process.env.UNSAFE_KEY, undefined);
  } finally {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalKey === undefined) delete process.env.MODEL_ROUTER_API_KEY;
    else process.env.MODEL_ROUTER_API_KEY = originalKey;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

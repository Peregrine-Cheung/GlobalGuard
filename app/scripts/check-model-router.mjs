import { modelRouterStatus, probeModelRouter } from "../src/model-router.mjs";
import { loadLocalEnv } from "../src/load-local-env.mjs";

await loadLocalEnv(new URL("../.env.local", import.meta.url));
const status = modelRouterStatus();
if (!status.configured) {
  console.error(JSON.stringify({
    ok: false,
    code: "MODEL_ROUTER_API_KEY_NOT_CONFIGURED",
    message: "请只在当前终端设置 MODEL_ROUTER_API_KEY，不要把密钥写入文件或聊天。",
    baseUrl: status.baseUrl
  }, null, 2));
  process.exitCode = 2;
} else {
  try {
    const result = await probeModelRouter();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: String(error.message || error).split(":")[0],
      message: "ModelRouter 连通性检查失败。密钥不会出现在输出中。"
    }, null, 2));
    process.exitCode = 1;
  }
}

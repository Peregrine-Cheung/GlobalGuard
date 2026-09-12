export function buildServerNodeArgs({ env, supportedFlags, watch = false, serverPath }) {
  const hasProxy = Boolean(env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY);
  const supportsEnvProxy = supportedFlags?.has('--use-env-proxy') === true;
  return [
    ...(hasProxy && supportsEnvProxy ? ['--use-env-proxy'] : []),
    ...(watch ? ['--watch'] : []),
    serverPath
  ];
}

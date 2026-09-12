export async function readSampleLibrary() {
  const responses = await Promise.all(['/samples/manifest.json', '/samples/catalog.json'].map(url => fetch(url)));
  if (responses.some(response => !response.ok)) throw new Error('素材清单暂不可用');
  const [manifest, catalog] = await Promise.all(responses.map(response => response.json()));
  return manifest.samples.map(sample => {
    if (!/^[a-z-]+$/.test(sample.id) || sample.path !== `/samples/${sample.id}.jpg`
      || !sample.sourcePage.startsWith('https://commons.wikimedia.org/wiki/File:')
      || !sample.licenseUrl.startsWith('https://creativecommons.org/')) throw new Error('素材来源格式不正确');
    return { ...sample, ...catalog[sample.id] };
  });
}

export function sampleProvenance(sample) {
  return {
    sampleId: sample.id, kind: sample.sourceKind, originalTitle: sample.filename,
    author: sample.author, sourcePage: sample.sourcePage, license: sample.license,
    licenseUrl: sample.licenseUrl, downloadedSha256: sample.sha256,
    acquiredAt: sample.acquiredAt, merchantEvidence: false,
    changes: `${sample.changes} 载入工作台时浏览器解码并转为 PNG。`
  };
}

export function attributionText(source, extraChanges = '') {
  return `${source.originalTitle}\n作者：${source.author}\n来源：${source.sourcePage}\n许可：${source.license}\n许可链接：${source.licenseUrl}\n处理：${source.changes}${extraChanges}\n下载素材 SHA-256：${source.downloadedSha256}\n公开照片测试素材，不代表商家合作、品牌背书或真实商品发布。\n如改编 CC BY-SA 4.0 素材并对外分发，保留署名、来源、改动说明与同许可。当前导出的此类改编图按 CC BY-SA 4.0 提供。许可不保证商标等其他权利。\n`;
}

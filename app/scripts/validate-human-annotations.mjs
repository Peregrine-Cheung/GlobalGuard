import fs from 'node:fs/promises';
import path from 'node:path';
import { validateHumanAnnotationPack } from '../public/annotation-validation.mjs';

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) throw new Error('USAGE: node scripts/validate-human-annotations.mjs <annotation.json>');
const absolute = path.resolve(inputPath);
const stat = await fs.stat(absolute);
if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('INVALID_ANNOTATION_FILE');
const pack = validateHumanAnnotationPack(JSON.parse(await fs.readFile(absolute, 'utf8')));
console.log(JSON.stringify({
  ok: true, datasetId: pack.datasetId, annotationStatus: pack.annotationStatus,
  annotator: pack.annotator, reviewedAt: pack.reviewedAt, cases: pack.cases.length,
  limitations: pack.limitations,
  notice: '结构校验通过；该文件仍是单人人工复核标签，不是多人金标准或模型准确率证明。'
}, null, 2));


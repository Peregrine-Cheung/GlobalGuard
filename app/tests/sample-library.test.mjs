import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sampleProvenance, attributionText } from '../public/sample-library.mjs';
const root = new URL('../public/samples/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
const catalog = JSON.parse(await fs.readFile(new URL('catalog.json', root), 'utf8'));

test('six local photographs have matching hashes, license evidence and provisional labels', async () => {
  assert.equal(manifest.samples.length, 6);
  assert.equal(new Set(manifest.samples.map(s => s.id)).size, 6);
  for (const sample of manifest.samples) {
    assert.match(sample.id, /^[a-z-]+$/);
    assert.equal(sample.path, `/samples/${sample.id}.jpg`);
    const bytes = await fs.readFile(new URL(`${sample.id}.jpg`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.sha256);
    assert.equal(bytes.length, sample.bytes);
    assert.ok(bytes.length < 8 * 1024 * 1024);
    assert.ok(sample.author && sample.licenseEvidence);
    assert.ok(['CC0', 'CC BY-SA 4.0'].includes(sample.license));
    assert.match(sample.sourcePage, /^https:\/\/commons.wikimedia.org\/wiki\/File:/);
    assert.equal(sample.generated, false);
    assert.equal(sample.merchantEvidence, false);
    assert.equal(sample.labelStatus, 'assistant-reviewed-provisional-not-human-gold');
    assert.ok(catalog[sample.id].focus && catalog[sample.id].copy);
  }
});

test('near-duplicate studio subjects stay grouped, giving five independent source groups', () => {
  assert.equal(catalog['tray-purple'].splitGroup, catalog['tray-deep'].splitGroup);
  assert.equal(new Set(Object.values(catalog).map(c => c.splitGroup)).size, 5);
});

test('exportable provenance retains credit and license but not provisional answers', () => {
  for (const sample of manifest.samples) {
    const source = sampleProvenance({ ...sample, ...catalog[sample.id] });
    assert.equal(source.downloadedSha256, sample.sha256);
    assert.equal(source.focus, undefined);
    assert.equal(source.observations, undefined);
    assert.equal(source.splitGroup, undefined);
    const credit = attributionText(source);
    assert.ok(credit.includes(sample.author) && credit.includes(sample.sourcePage));
    assert.ok(credit.includes(sample.licenseUrl) && credit.includes('不代表商家合作'));
  }
});

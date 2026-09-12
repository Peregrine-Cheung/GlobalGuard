const ROUTES = {
  US_GOOGLE: { code: 'US', name: 'Google Merchant 主图', accent: 'blue' },
  CN_ADS: { code: 'CN', name: '中国电商广告', accent: 'orange' },
  EU_GPSR: { code: 'EU', name: 'GPSR 在线要约', accent: 'green' }
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function policyCard(policy, currentVersion) {
  const route = ROUTES[policy.route] || { code: policy.route, name: policy.route, accent: 'blue' };
  const card = element('article', `policy-card ${route.accent}`);
  const head = element('div', 'policy-head');
  head.append(element('span', 'policy-code', route.code));
  const title = element('div');
  title.append(element('h3', '', route.name), element('code', '', policy.policyVersion));
  head.append(title, element('span', currentVersion === policy.policyVersion ? 'sync-badge' : 'sync-badge mismatch', currentVersion === policy.policyVersion ? '版本一致' : '版本漂移'));
  const allow = element('div', 'policy-detail');
  allow.append(element('small', '', 'MODEL MAY RETURN'), element('p', '', policy.modelMayReturn));
  const owner = element('div', 'policy-detail');
  owner.append(element('small', '', 'DECISION OWNER'), element('p', '', policy.decisionOwner));
  const result = element('div', 'policy-result');
  result.append(
    element('b', '', `${policy.passed}/${policy.cases}`),
    element('span', '', `接受 ${policy.acceptPathsPassed}/${policy.expectedAccept} · 拒绝 ${policy.rejectPathsPassed}/${policy.expectedReject}`)
  );
  card.append(head, allow, owner, result);
  return card;
}

function humanCaseCard(item) {
  const card = element('article', `human-case-card ${item.strictAgreement ? 'match' : 'mismatch'}`);
  const state = element('span', 'case-state', item.strictAgreement ? '一致' : '待复核');
  card.append(element('b', '', item.id), state);
  if (item.checks) {
    const labels = {
      ocrStatus: 'OCR状态', ocrText: '逐字文本', regionCount: '区域数量',
      regionSemantics: '区域语义', regionLocalization: '区域定位', visualFactSet: '可见事实'
    };
    const checks = element('div', 'case-checks');
    for (const [key, label] of Object.entries(labels)) {
      checks.append(element('span', item.checks[key] ? 'check-pass' : 'check-fail', `${item.checks[key] ? '✓' : '×'} ${label}`));
    }
    card.append(checks);
  }
  return card;
}

async function loadValidationCenter() {
  const card = document.querySelector('#integrity-card');
  try {
    const response = await fetch('/api/validation-center', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const data = await response.json();
    const report = data.report;
    const human = data.humanReview.report;
    const robustness = data.robustnessReview.report;
    const v6Recovery = data.robustnessV6Recovery.report;
    const v6Review = data.robustnessV6Review.report;
    const versionAligned = report.policies.every(policy => data.runtime.observationPolicies[policy.route] === policy.policyVersion);
    const ready = data.integrity.synchronized && report.totals.allPassed && versionAligned
      && data.humanReview.integrity.validated && data.robustnessReview.integrity.validated
      && data.robustnessV6Recovery.integrity.validated && data.robustnessV6Review.integrity.validated;
    card.className = `integrity-card ${ready ? 'ready' : 'review'}`;
    card.dataset.state = ready ? 'ready' : 'review';
    document.querySelector('.integrity-mark').textContent = ready ? '✓' : '!';
    document.querySelector('#integrity-title').textContent = ready ? '结构门禁与人工对照证据已核验' : '报告或策略需要重新核对';
    document.querySelector('#integrity-copy').textContent = ready
      ? '结构契约27/27；v5十图严格一致3/10；v6六张复测结构6/6、严格一致2/6。均不代表模型准确率。'
      : '请重新运行 npm run verify:demo，确认报告和当前策略版本。';
    document.querySelector('#suite-id').textContent = report.suiteId;
    document.querySelector('#metric-policies').textContent = report.totals.policies;
    document.querySelector('#metric-cases').textContent = report.totals.cases;
    document.querySelector('#metric-passed').textContent = `${report.totals.passed}/${report.totals.cases}`;
    document.querySelector('#metric-live').textContent = data.boundaries.realModelCallsInReport;
    document.querySelector('#policy-grid').replaceChildren(...report.policies.map(policy => policyCard(policy, data.runtime.observationPolicies[policy.route])));
    document.querySelector('#human-run-id').textContent = `${human.modelRun.model} · ${human.modelRun.observationPolicy}`;
    document.querySelector('#human-cases').textContent = human.totals.cases;
    document.querySelector('#human-requests').textContent = `${human.totals.requestSucceeded}/${human.totals.cases}`;
    document.querySelector('#human-contracts').textContent = `${human.totals.contractPassed}/${human.totals.cases}`;
    document.querySelector('#human-agreement').textContent = `${human.totals.strictAgreement}/${human.totals.cases}`;
    document.querySelector('#human-case-grid').replaceChildren(...human.cases.map(humanCaseCard));
    const mismatch = human.knownMismatch;
    document.querySelector('#mismatch-title').textContent = `${mismatch.caseId} · 极小不可读文字漏检`;
    document.querySelector('#mismatch-copy').textContent = '人工观察到商品实体上的不可可靠转写文字痕迹和局部清晰度不足；模型返回未见文字且没有文字区域。该差异保留为人工复核出口，不通过针对单一夹具堆提示词制造满分。';
    document.querySelector('#robustness-run-id').textContent = `${robustness.model} · ${robustness.observationPolicy}`;
    document.querySelector('#robustness-cases').textContent = robustness.cases.length;
    document.querySelector('#robustness-requests').textContent = `${robustness.executionControls.supplierResponses}/${robustness.cases.length}`;
    document.querySelector('#robustness-contracts').textContent = `${robustness.evaluation.localStructureContractsPassed}/${robustness.cases.length}`;
    document.querySelector('#robustness-agreement').textContent = `${robustness.evaluation.strictSingleHumanAgreement}/${robustness.cases.length}`;
    document.querySelector('#robustness-tokens').textContent = robustness.executionControls.totalTokens.toLocaleString('zh-CN');
    document.querySelector('#robustness-case-grid').replaceChildren(...robustness.cases.map(item => humanCaseCard({
      id: item.id,
      strictAgreement: item.strictAgreement,
      checks: null
    })));
    document.querySelector('#v6-run-id').textContent = `${v6Review.model} · ${v6Review.observationPolicy}`;
    document.querySelector('#v6-requests').textContent = `${v6Review.executionControls.supplierResponses}/6`;
    document.querySelector('#v6-contracts').textContent = `${v6Review.executionControls.localStructureContractsPassed}/6`;
    document.querySelector('#v6-tokens').textContent = v6Review.executionControls.totalTokens.toLocaleString('zh-CN');
    document.querySelector('#v6-agreement').textContent = `${v6Review.evaluation.strictSingleHumanAgreement}/6`;
    document.querySelector('#evidence-file').textContent = data.integrity.evidenceFile;
    document.querySelector('#evidence-hash').textContent = data.integrity.sha256;
    document.querySelector('#human-evidence-file').textContent = data.humanReview.integrity.evidenceFile;
    document.querySelector('#human-evidence-hash').textContent = data.humanReview.integrity.sha256;
    document.querySelector('#robustness-evidence-file').textContent = data.robustnessReview.integrity.evidenceFile;
    document.querySelector('#robustness-evidence-hash').textContent = data.robustnessReview.integrity.sha256;
    document.querySelector('#v6-evidence-file').textContent = data.robustnessV6Review.integrity.evidenceFile;
    document.querySelector('#v6-evidence-hash').textContent = data.robustnessV6Review.integrity.sha256;
    document.querySelector('#v6-recovery-evidence-file').textContent = data.robustnessV6Recovery.integrity.evidenceFile;
    document.querySelector('#v6-recovery-evidence-hash').textContent = data.robustnessV6Recovery.integrity.sha256;
    document.querySelector('#rulepack-id').textContent = `${data.runtime.rulepack.id}@${data.runtime.rulepack.version} · ${data.runtime.rulepack.effectiveDate}`;
    document.querySelector('#evidence-notice').textContent = report.notice;
  } catch (error) {
    card.className = 'integrity-card error';
    card.dataset.state = 'error';
    document.querySelector('.integrity-mark').textContent = '×';
    document.querySelector('#integrity-title').textContent = '本地验证报告载入失败';
    document.querySelector('#integrity-copy').textContent = `未把错误当作通过：${error.message}`;
  }
}

loadValidationCenter();

import { runAdversarialSimulation } from '../src/model-contract-adversarial-sim.mjs';

const report = runAdversarialSimulation(30);
console.log(JSON.stringify(report, null, 2));
if (!report.allExpectedMutationsRejected) process.exitCode = 1;

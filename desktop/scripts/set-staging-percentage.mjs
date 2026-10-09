import fs from 'node:fs';

const [, , file, rawPercentage] = process.argv;
const percentage = Number(rawPercentage);

if (!file || !Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
  throw new Error('Usage: set-staging-percentage.mjs <latest.yml> <integer 0-100>');
}

const source = fs.readFileSync(file, 'utf8');
const line = `stagingPercentage: ${percentage}`;
const output = /^stagingPercentage:\s*\d+\s*$/m.test(source)
  ? source.replace(/^stagingPercentage:\s*\d+\s*$/m, line)
  : `${source.trimEnd()}\n${line}\n`;

fs.writeFileSync(file, output);

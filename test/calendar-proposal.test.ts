import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { propose } from "../src/academic/calendar.ts";
import { academicOsEntrypoint, Products } from "../src/academic/products.ts";
import { standInProducts } from "./academic-machine.ts";

it(
  "keeps overlapping Proposal payloads separate until their product processes read them",
  { timeout: 10_000 },
  async () => {
    const machine = standInProducts();
    const products = new Products(machine.deployment.academic);
    const ready = join(machine.root, "proposal-ready.log");
    writeFileSync(
      academicOsEntrypoint(products.paths),
      `
const { appendFileSync, readFileSync, statSync } = require('node:fs');
const ready = ${JSON.stringify(ready)};
appendFileSync(ready, 'ready\\n');
const timer = setInterval(() => {
  if (readFileSync(ready, 'utf8').trim().split('\\n').length < 2) return;
  clearInterval(timer);
  const input = process.argv[process.argv.indexOf('--input') + 1];
  process.stdout.write(JSON.stringify({ item: JSON.parse(readFileSync(input, 'utf8')).item, mode: statSync(input).mode & 0o777 }));
}, 5);
`,
    );

    const [one, two] = await Promise.all([
      propose(products, { summary: "First item" }),
      propose(products, { summary: "Second item" }),
    ]);

    assert.deepEqual(one.report, { item: { summary: "First item" }, mode: 0o600 });
    assert.deepEqual(two.report, { item: { summary: "Second item" }, mode: 0o600 });
    assert.notEqual(one.input, two.input);
    assert.equal(existsSync(one.input), false);
    assert.equal(existsSync(two.input), false);
  },
);

it("removes a Proposal input after the product refuses it", async () => {
  const machine = standInProducts({ academicOs: { exitCode: 2 } });
  const proposed = await propose(new Products(machine.deployment.academic), {
    summary: "Refused item",
  });
  assert.equal(proposed.ok, false);
  assert.equal(existsSync(proposed.input), false);
});

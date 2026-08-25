/**
 * Scores the benchmark set against the index as it stands and posts the retrieval report where it
 * is worth posting, which is what *on demand* means for the loop ADR-0007 describes.
 *
 *   node src/cli/report-retrieval.ts <deployment.json>
 *
 * The report is written to a file by the search unit whatever this prints, so a run whose post was
 * refused is still a run that left its numbers behind. It posts through the same delivery the
 * unattended beat uses, so a run posted here is not posted a second time when that beat next fires.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDeployment } from "../adapter/deployment.ts";
import { scoreAndDeliverRetrieval } from "../monitor/retrieval-delivery.ts";

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: report-retrieval <deployment.json>");
  process.exit(2);
}

const deployment = readDeployment(JSON.parse(await readFile(resolve(source), "utf8")));
const delivered = await scoreAndDeliverRetrieval(deployment);
console.log(JSON.stringify(delivered.report, null, 2));
if (!delivered.posted) console.error(delivered.said);

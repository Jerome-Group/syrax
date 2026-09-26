import assert from "node:assert/strict";
import { it } from "node:test";
import { whatIsDue } from "../src/academic/calendar.ts";
import { Products } from "../src/academic/products.ts";
import { standInProducts } from "./academic-machine.ts";

async function mirrored(recurrence: string[], start = "2026-09-21") {
  const machine = standInProducts();
  machine.writeMirror("academic", {
    items: [
      {
        actualCalendarRole: "Academic",
        event: {
          id: "repeat",
          summary: "Recurring class",
          start: { date: start },
          recurrence,
        },
      },
    ],
  });
  return await whatIsDue(new Products(machine.deployment.academic), {
    now: new Date(2026, 8, 21),
    days: 22,
  });
}

function dates(due: Awaited<ReturnType<typeof mirrored>>) {
  return due.due.map((one) => {
    const at = new Date(one.at);
    return `${at.getMonth() + 1}-${at.getDate()}`;
  });
}

it("applies DAILY intervals before filtering weekdays", async () => {
  const due = await mirrored(["RRULE:FREQ=DAILY;INTERVAL=3;BYDAY=MO,WE,FR"]);
  assert.deepEqual(dates(due), ["9-21", "9-30", "10-9", "10-12"]);
  assert.deepEqual(due.unexpanded, []);
});

it("uses Monday as the default week start for WEEKLY interval cycles", async () => {
  const due = await mirrored(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU"], "2026-09-23");
  assert.deepEqual(dates(due), ["9-23", "9-27", "10-7", "10-11"]);
});

it("honors an explicit Sunday week start", async () => {
  const due = await mirrored(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU;WKST=SU"], "2026-09-23");
  assert.deepEqual(dates(due), ["9-23", "10-4", "10-7"]);
});

it("reports unsupported recurrence properties and invalid values without inventing dates", async () => {
  for (const recurrence of [
    ["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20260922"],
    ["RRULE:FREQ=DAILY", "RDATE;VALUE=DATE:20260925"],
    ["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"],
    ["RRULE:FREQ=DAILY;COUNT=0"],
    ["RRULE:FREQ=DAILY;COUNT=abc"],
    ["RRULE:FREQ=DAILY;COUNT=1e2"],
    ["RRULE:FREQ=DAILY;INTERVAL=0x2"],
    ["RRULE:FREQ=DAILY;UNTIL=invalid"],
    ["RRULE:FREQ=DAILY;UNTIL=20260231"],
    ["RRULE:FREQ=DAILY;WKST=XX"],
    ["RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261001"],
    ["RRULE:FREQ=DAILY;INTERVAL=1;INTERVAL=2"],
  ]) {
    const due = await mirrored(recurrence);
    assert.deepEqual(due.due, [], recurrence.join(";"));
    assert.deepEqual(
      due.unexpanded.map((one) => one.recurrence),
      [recurrence],
    );
  }
});

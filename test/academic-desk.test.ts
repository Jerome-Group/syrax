/**
 * The academic desk at its two seams: the command each product is run with, and the file each
 * product left behind. Nothing here reaches Google or NTULearn, which is the point — Syrax holds no
 * credential of theirs, so a stand-in product is a faithful stand-in for the whole of what it does.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  academicServerName,
  announcementsToolName,
  auditToolName,
  dueToolName,
  everyAcademicTool,
  mcpPath,
  promoteToolName,
  proposeToolName,
  syncStatusToolName,
  syncToolName,
} from "../src/adapter/academic-tools.ts";
import { AcademicDesk, serveAcademicDesk } from "../src/academic/desk.ts";
import type { Due } from "../src/academic/calendar.ts";
import type { SyncVerdict, Announcement } from "../src/academic/ntulearn.ts";
import { freePort, standInProducts, type StandInProducts } from "./academic-machine.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

function call(desk: AcademicDesk, name: string, given: Record<string, unknown> = {}) {
  const tool = desk.tools().find((one) => one.name === name);
  assert.ok(tool !== undefined, `${name} is not a tool the desk serves`);
  return tool.call(given);
}

/** One mirror row in the shape academic-os writes it. */
function item(role: string, event: Record<string, unknown>) {
  return { actualCalendarRole: role, access: "owned", event };
}

function atLocal(day: string, time: string): string {
  return `${day}T${time}`;
}

describe("what's due", () => {
  it("refreshes the product's own calendar and reads what that Refresh wrote", async () => {
    const products = standInProducts();
    products.writeMirror("academic", {
      lastSuccessfulRefresh: "2026-08-25T05:00:00.000Z",
      freshness: "fresh",
      items: [
        item("Academic", {
          id: "one",
          summary: "MH2100 assignment 3",
          start: { date: "2026-08-26" },
        }),
      ],
    });
    const desk = new AcademicDesk(products.deployment);

    const due = (await call(desk, dueToolName, { days: 7 })) as Due;

    assert.deepEqual(products.academicOsRuns()[0]?.slice(0, 2), ["calendar", "refresh"]);
    assert.equal(due.refreshed, true);
    assert.deepEqual(
      due.due.map((one) => one.summary),
      ["MH2100 assignment 3"],
    );
    assert.equal(due.calendars[0]?.lastSuccessfulRefresh, "2026-08-25T05:00:00.000Z");
  });

  it("never reads Routine, so sleep and meals are not what is due", async () => {
    const products = standInProducts();
    products.writeMirror("routine", {
      freshness: "fresh",
      items: [item("Routine", { id: "sleep", summary: "Sleep", start: { date: "2026-08-26" } })],
    });
    products.writeMirror("commitments", {
      freshness: "fresh",
      items: [
        item("Commitments", { id: "dentist", summary: "Dentist", start: { date: "2026-08-26" } }),
      ],
    });
    const desk = new AcademicDesk(products.deployment);

    const due = (await call(desk, dueToolName)) as Due;

    assert.deepEqual(
      due.due.map((one) => one.summary),
      ["Dentist"],
    );
    assert.deepEqual(
      due.calendars.map((one) => one.role),
      ["Academic", "Commitments"],
    );
  });

  it("expands a weekly class and says which rules it did not walk", async () => {
    const products = standInProducts();
    const monday = mondayAfter(new Date());
    products.writeMirror("academic", {
      freshness: "fresh",
      items: [
        item("Academic", {
          id: "class",
          summary: "MH2500 lecture",
          start: { dateTime: atLocal(isoDay(monday), "10:00:00") },
          end: { dateTime: atLocal(isoDay(monday), "12:00:00") },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        }),
        item("Academic", {
          id: "monthly",
          summary: "Faculty seminar",
          start: { dateTime: atLocal(isoDay(monday), "15:00:00") },
          recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1"],
        }),
      ],
    });
    const desk = new AcademicDesk(products.deployment);

    const due = (await call(desk, dueToolName, { days: 8 })) as Due;

    assert.deepEqual(
      due.due.map((one) => one.summary),
      ["MH2500 lecture"],
    );
    assert.deepEqual(
      due.unexpanded.map((one) => one.summary),
      ["Faculty seminar"],
    );
  });

  it("drops an occurrence the calendar cancelled, and keeps the one it moved", async () => {
    const products = standInProducts();
    // Tomorrow, so the whole day is ahead of the window's own start whenever the suite runs.
    const day = isoDay(plusOneDay(new Date()));
    products.writeMirror("academic", {
      freshness: "fresh",
      items: [
        item("Academic", {
          id: "class",
          summary: "MH2500 lecture",
          start: { dateTime: atLocal(day, "09:00:00") },
          recurrence: ["RRULE:FREQ=DAILY"],
        }),
        item("Academic", {
          id: "class_moved",
          summary: "MH2500 lecture (moved)",
          recurringEventId: "class",
          originalStartTime: { dateTime: atLocal(day, "09:00:00") },
          start: { dateTime: atLocal(day, "14:00:00") },
        }),
      ],
    });
    const desk = new AcademicDesk(products.deployment);

    const due = (await call(desk, dueToolName, { days: 2 })) as Due;

    assert.deepEqual(
      due.due.map((one) => one.summary),
      ["MH2500 lecture (moved)"],
    );
  });

  it("answers with the calendar it has and says it is stale when the Refresh failed", async () => {
    const products = standInProducts({ academicOs: { exitCode: 2, report: { outcome: "stale" } } });
    products.writeMirror("academic", {
      lastSuccessfulRefresh: "2026-08-20T05:00:00.000Z",
      freshness: "stale",
      items: [],
    });
    const desk = new AcademicDesk(products.deployment);

    const due = (await call(desk, dueToolName)) as Due;

    assert.equal(due.refreshed, false);
    assert.match(due.said, /did not finish/);
    assert.equal(due.calendars[0]?.freshness, "stale");
  });
});

describe("how the overnight jobs went", () => {
  it("reads the digest the watchdog wrote, and never re-derives a verdict", async () => {
    const products = standInProducts();
    products.writeVerdict({
      verdict: "green",
      message: "synced, 0 new files",
      timestamp: "2026-08-25T05:00:01.234Z",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.verdict, "green");
    assert.equal(verdict.needsLogin, false);
    assert.deepEqual(products.ntulearnRuns(), []);
  });

  it("says the session needs re-opening where the digest says the session lapsed", async () => {
    const products = standInProducts();
    // The watchdog's own sentence for this case, which is the one thing only the Owner can clear.
    products.writeVerdict({
      verdict: "red",
      message: "session lapsed — run `npm run login`",
      timestamp: "2026-08-25T05:00:01.234Z",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, true);
    assert.equal(verdict.failed, "the session");
  });

  it("does not blame the session for a red the digest blames on the mount", async () => {
    const products = standInProducts();
    // Captured from the mini on 2026-08-24, which is the red that named this rule (#180).
    products.writeVerdict({
      verdict: "red",
      message:
        "crash/timeout after 3 attempts; stderr tail: EACCES: permission denied, mkdir '/Users/one/Library/CloudStorage/GoogleDrive-one/My Drive'; inspect the run log for the captured attempts",
      timestamp: "2026-08-24T21:30:41.582Z",
      runLog: "logs/2026-08-24T21-30-41-582Z-3ab8e5fd.json",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, false);
    assert.equal(verdict.failed, "something else");
  });

  it("does not blame the session for a destination the digest says is unreachable", async () => {
    const products = standInProducts();
    products.writeVerdict({
      verdict: "red",
      message:
        "Destination /one/MH2100/NTULearn is unreachable — permission denied at /one/My Drive; correct driveMountPath or destination permissions, then run: npm run watchdog",
      timestamp: "2026-08-25T05:00:01.234Z",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, false);
    assert.equal(verdict.failed, "something else");
  });

  it("says a red it cannot place is unclear rather than guessing at either cause", async () => {
    const products = standInProducts();
    products.writeVerdict({
      verdict: "red",
      message: "the moon was in the wrong phase",
      timestamp: "2026-08-25T05:00:01.234Z",
      runLog: "logs/2026-08-25T05-00-01-234Z-abc.json",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, false);
    assert.equal(verdict.failed, "unclear");
    assert.equal(verdict.runLog, "logs/2026-08-25T05-00-01-234Z-abc.json");
  });

  it("calls a crash that captured nothing unclear, since it names no cause at all", async () => {
    const products = standInProducts();
    // `(none)` is the watchdog's own placeholder for a crash it captured no stderr from.
    products.writeVerdict({
      verdict: "red",
      message:
        "crash/timeout after 3 attempts; stderr tail: (none); inspect the run log for the captured attempts",
      timestamp: "2026-08-25T05:00:01.234Z",
      runLog: "logs/2026-08-25T05-00-01-234Z-abc.json",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, false);
    assert.equal(verdict.failed, "unclear");
  });

  it("blames the session where a crash's own tail says the session is gone", async () => {
    const products = standInProducts();
    products.writeVerdict({
      verdict: "red",
      message:
        "crash/timeout after 3 attempts; stderr tail: the saved session is no longer signed in; inspect the run log for the captured attempts",
      timestamp: "2026-08-25T05:00:01.234Z",
    });
    const desk = new AcademicDesk(products.deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.needsLogin, true);
  });

  it("says nothing has been written rather than inventing a verdict", async () => {
    const desk = new AcademicDesk(standInProducts().deployment);

    const verdict = (await call(desk, syncStatusToolName)) as SyncVerdict;

    assert.equal(verdict.verdict, "unknown");
    assert.equal(verdict.at, null);
    assert.equal(verdict.needsLogin, false);
  });
});

describe("what arrived", () => {
  it("names the module and the title of everything written inside the window", async () => {
    const products = standInProducts();
    const now = Date.now();
    products.writeAnnouncement(
      "Y2S1/MH2100/NTULearn",
      "01 Quiz 2 postponed",
      new Date(now - 3600_000),
    );
    products.writeAnnouncement(
      "Y2S1/CC0006/NTULearn",
      "07 Old news",
      new Date(now - 5 * 86_400_000),
    );
    const desk = new AcademicDesk(products.deployment);

    const arrived = (await call(desk, announcementsToolName, { hours: 24 })) as Announcement[];

    assert.deepEqual(arrived, [
      { module: "MH2100", title: "01 Quiz 2 postponed", at: arrived[0]!.at },
    ]);
  });
});

describe("the folder audit", () => {
  it("is the product's own audit, run on demand and reported as it stands", async () => {
    const products = standInProducts({ academicOs: { report: { findings: [] }, exitCode: 1 } });
    const desk = new AcademicDesk(products.deployment);

    const audited = (await call(desk, auditToolName)) as { ok: boolean; exit: number };

    assert.deepEqual(products.academicOsRuns()[0]?.[0], "audit");
    assert.equal(audited.ok, false);
    assert.equal(audited.exit, 1);
  });
});

describe("the two writes", () => {
  it("asks for a tap and writes nothing until it gets one", async () => {
    const products = standInProducts();
    const desk = new AcademicDesk(products.deployment);

    const asked = (await call(desk, syncToolName)) as {
      confirmed: boolean;
      button: { value: string };
    };

    assert.equal(asked.confirmed, false);
    assert.match(asked.button.value, /^confirm:/);
    assert.deepEqual(products.ntulearnRuns(), []);
  });

  it("runs the sync on the value the Owner tapped, and on that value once", async () => {
    const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    after(() => telegram.close());
    const products = standInProducts({ telegram });
    const desk = new AcademicDesk(products.deployment);
    const asked = (await call(desk, syncToolName)) as { button: { value: string } };

    const started = (await call(desk, syncToolName, {
      confirmation: asked.button.value,
    })) as { confirmed: boolean; started: boolean };
    await ranSomething(products.ntulearnRuns);
    const again = (await call(desk, syncToolName, { confirmation: asked.button.value })) as {
      expired?: boolean;
    };

    assert.equal(started.confirmed, true);
    assert.equal(started.started, true);
    assert.deepEqual(products.ntulearnRuns(), [["sync", "all"]]);
    assert.equal(again.expired, true);
    // The run outlives the turn that started it, so what it did arrives in Academic by itself.
    const posted = await telegram.waitFor("sendMessage");
    assert.match(String(posted.body.text), /sync finished/);
  });

  it("runs one sync at a time, since two would spend the one session against each other", async () => {
    const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    after(() => telegram.close());
    const products = standInProducts({ telegram });
    const desk = new AcademicDesk(products.deployment);
    const first = (await call(desk, syncToolName)) as { button: { value: string } };
    const second = (await call(desk, syncToolName)) as { button: { value: string } };

    const started = (await call(desk, syncToolName, {
      confirmation: first.button.value,
    })) as { started: boolean };
    const alongside = (await call(desk, syncToolName, {
      confirmation: second.button.value,
    })) as { started: boolean; say: string };

    assert.equal(started.started, true);
    assert.equal(alongside.started, false);
    assert.match(alongside.say, /already running/);
    await telegram.waitFor("sendMessage");
    assert.equal(products.ntulearnRuns().length, 1);
  });

  it("refuses a confirmation this desk never minted", async () => {
    const products = standInProducts();
    const desk = new AcademicDesk(products.deployment);

    const answered = (await call(desk, syncToolName, {
      confirmation: "confirm:0123456789abcdef",
    })) as { confirmed: boolean; expired?: boolean };

    assert.equal(answered.confirmed, false);
    assert.equal(answered.expired, true);
    assert.deepEqual(products.ntulearnRuns(), []);
  });

  it("promotes the Proposal the Owner tapped for, and never one they did not", async () => {
    const products = standInProducts({
      academicOs: { report: { outcome: "promoted" } },
    });
    const desk = new AcademicDesk(products.deployment);
    const asked = (await call(desk, promoteToolName, { proposalId: "proposal-abc" })) as {
      button: { value: string; text: string };
    };

    assert.match(asked.button.text, /proposal-abc/);
    assert.deepEqual(products.academicOsRuns(), []);

    const promoted = (await call(desk, promoteToolName, {
      proposalId: "proposal-abc",
      confirmation: asked.button.value,
    })) as { confirmed: boolean; ok: boolean };

    assert.equal(promoted.confirmed, true);
    assert.equal(promoted.ok, true);
    assert.deepEqual(products.academicOsRuns()[0]?.slice(0, 3), [
      "calendar",
      "promote",
      "proposal-abc",
    ]);
  });

  it("writes a Proposal without a tap, since Live never sees one", async () => {
    const products = standInProducts({ academicOs: { report: { proposalId: "proposal-abc" } } });
    const desk = new AcademicDesk(products.deployment);

    const proposed = (await call(desk, proposeToolName, {
      item: { kind: "all-day-milestone", calendarRole: "Academic", summary: "Report due" },
    })) as { ok: boolean; input: string };

    assert.equal(proposed.ok, true);
    const [command, subcommand, flag, path] = products.academicOsRuns()[0]!;
    assert.deepEqual([command, subcommand, flag], ["calendar", "propose", "--input"]);
    assert.equal(path, proposed.input);
  });
});

describe("the desk over its own wire", () => {
  it("serves the seven tools the Academic chat is given, and nothing else", async () => {
    const products = standInProducts({ overrides: { academicPort: await freePort() } });
    const { server, port } = await serveAcademicDesk(products.deployment);
    try {
      const listed = await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const served = (listed.result as { tools: { name: string }[] }).tools.map(
        (tool) => `${academicServerName}__${tool.name}`,
      );
      assert.deepEqual(served, everyAcademicTool);
    } finally {
      server.close();
    }
  });
});

async function rpc(port: number, message: unknown): Promise<{ result?: unknown; error?: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${mcpPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  return (await response.json()) as { result?: unknown };
}

/** The sync is started rather than awaited, so a test that asserts on it waits for the run. */
async function ranSomething(runs: StandInProducts["ntulearnRuns"]): Promise<void> {
  for (let waited = 0; waited < 100; waited++) {
    if (runs().length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function plusOneDay(now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

function mondayAfter(now: Date): Date {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  return monday;
}

function isoDay(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

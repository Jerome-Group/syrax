/**
 * The morning brief at the Telegram wire, which is the only place its contract can be observed: it
 * is a message that goes out, and the empty morning is the case that matters — a brief that skipped
 * a quiet day would make a dead Syrax look like an ordinary Tuesday (ADR-0005, ADR-0013).
 */

import assert from "node:assert/strict";
import { readCarrierMap } from "../src/adapter/carriers.ts";
import { after, describe, it } from "node:test";
import { AcademicDesk } from "../src/academic/desk.ts";
import { reLoginLine } from "../src/academic/ntulearn.ts";
import { standInProducts, type StandInProducts } from "./academic-machine.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";
import { ownerTelegramUserId } from "./machine.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

async function machine(
  options: Parameters<typeof standInProducts>[0] = {},
): Promise<{ telegram: TelegramStub; products: StandInProducts; desk: AcademicDesk }> {
  const telegram = await TelegramStub.start(botToken);
  after(() => telegram.close());
  const products = standInProducts({ ...options, telegram });
  return { telegram, products, desk: new AcademicDesk(products.deployment) };
}

function posted(telegram: TelegramStub) {
  const calls = telegram.matching("sendMessage");
  assert.equal(calls.length, 1, "the brief is one message");
  return calls[0]!.body as { text: string; chat_id: number; message_thread_id?: number };
}

describe("the morning brief", () => {
  it("posts on a day with nothing on it, because its absence is the signal", async () => {
    const { telegram, desk } = await machine();

    await desk.brief();

    const message = posted(telegram);
    assert.match(message.text, /Today: nothing on the calendar\./);
    assert.match(message.text, /Overnight: no new announcements\./);
    assert.match(message.text, /Sync: unknown/);
  });

  it("lands in the Academic chat, where the follow-up question already has its context", async () => {
    const { telegram, products, desk } = await machine();

    await desk.brief();

    const message = posted(telegram);
    assert.equal(message.chat_id, ownerTelegramUserId);
    assert.equal(
      message.message_thread_id,
      readCarrierMap(products.deployment.carrierMap).academic,
    );
  });

  it("leads with the day ahead, then what arrived, then the verdict", async () => {
    const { telegram, products, desk } = await machine();
    const now = new Date();
    products.writeMirror("academic", {
      freshness: "fresh",
      items: [
        {
          actualCalendarRole: "Academic",
          event: {
            id: "lecture",
            summary: "MH2500 lecture",
            start: { dateTime: at(now, 10) },
            end: { dateTime: at(now, 12) },
          },
        },
      ],
    });
    products.writeAnnouncement(
      "Y2S1/MH2100/NTULearn",
      "03 Tutorial 4 uploaded",
      new Date(+now - 3600_000),
    );
    products.writeVerdict({
      verdict: "green",
      message: "synced, 2 new files",
      timestamp: now.toISOString(),
    });

    await desk.brief(now);

    const { text } = posted(telegram);
    assert.match(text, /Today:\n- 10:00 — MH2500 lecture/);
    assert.match(text, /Overnight:\n- MH2100: 03 Tutorial 4 uploaded/);
    assert.match(text, /Sync: green — synced, 2 new files\./);
    assert.ok(
      text.indexOf("Today:") < text.indexOf("Overnight:"),
      "the day ahead leads, because it is the part with a decision attached",
    );
    assert.ok(text.indexOf("Overnight:") < text.indexOf("Sync:"));
  });

  it("carries the one line only the Owner can act on when the verdict is not green", async () => {
    const { telegram, products, desk } = await machine();
    products.writeVerdict({
      verdict: "red",
      message: "the saved session has lapsed",
      timestamp: new Date().toISOString(),
    });

    await desk.brief();

    assert.ok(posted(telegram).text.endsWith(reLoginLine));
  });

  it("still posts when a product cannot be run at all", async () => {
    const { telegram, products, desk } = await machine();
    products.writeMirror("academic", { freshness: "fresh", items: [] });
    // What a machine whose academic-os has never been built looks like: the Refresh cannot run.
    products.breakAcademicOs();

    await desk.brief();

    assert.match(posted(telegram).text, /Today: nothing on the calendar\./);
  });
});

/** An hour today, in the machine's own clock, which is the one the calendar is read in. */
function at(now: Date, hour: number): string {
  const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour);
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(hour)}:00:00`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

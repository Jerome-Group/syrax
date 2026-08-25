/**
 * The academic desk: the tool layer the Academic chat reaches, and the morning brief launchd pokes.
 *
 * It is a unit of Syrax's for the reason the lane monitor is one — something has to be resident and
 * hold what a turn cannot — but what it holds is deliberately almost nothing: the confirmations it
 * has minted, and the chat surface. Every fact it answers with comes from a product's own report or
 * a product's own file, read at the moment it is asked (#10's refresh-then-read). It holds no Google
 * and no NTULearn credential, and it builds no capability functionality of its own.
 *
 * **The two writes stand behind a tap.** `sync` and `promote` mint a confirmation and stop; the
 * write happens on the value the Owner tapped and on no other input. The reads are not gated,
 * because a Refresh caches and a Proposal is private — confirmation attaches to consequence rather
 * than to the word *refresh*.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  academicServerName,
  announcementsToolName,
  auditToolName,
  briefPath,
  dueToolName,
  mcpPath,
  promoteToolName,
  proposeToolName,
  syncStatusToolName,
  syncToolName,
} from "../adapter/academic-tools.ts";
import { chats } from "../adapter/chats.ts";
import type { Deployment } from "../adapter/deployment.ts";
import { ensurePrivateDirectory } from "../adapter/private-state.ts";
import { mcpEndpoint, type Tool } from "../monitor/mcp.ts";
import { ChatSurface } from "../surface/chat-surface.ts";
import { composeBrief, modulesRoot, postBrief, type Brief } from "./brief.ts";
import { dueWindowDays, promote, propose, whatIsDue } from "./calendar.ts";
import { Confirmations, type Write } from "./confirmations.ts";
import { announcementsSince, runSync, syncVerdict, type SyncRun } from "./ntulearn.ts";
import { auditTimeoutMs, Products } from "./products.ts";

/** What `announcements` looks back over when the Owner names no window: since this time yesterday. */
export const announcementsSinceHours = 24;

/** A write that has not been confirmed, answered as the button the Owner has to be shown. */
export type Unconfirmed = {
  confirmed: false;
  button: { text: string; value: string };
  say: string;
};

export class AcademicDesk {
  readonly #deployment: Deployment;
  readonly #products: Products;
  #confirmations = new Confirmations();
  #syncing: Promise<unknown> | null = null;

  constructor(deployment: Deployment) {
    this.#deployment = deployment;
    this.#products = new Products(deployment.academic);
    ensurePrivateDirectory(this.#products.paths.academicState);
  }

  /** The brief, composed and posted. It goes out on an empty day: that is the whole contract. */
  async brief(now: Date = new Date()): Promise<Brief> {
    const brief = await composeBrief(this.#deployment, this.#products, now);
    await postBrief(this.#deployment, brief);
    return brief;
  }

  tools(): Tool[] {
    return [
      {
        name: dueToolName,
        description:
          "What is due: Syrax asks academic-os for its own calendar Refresh, then reads the " +
          "Academic and Commitments calendars it wrote. Call it before answering anything about " +
          "deadlines, classes or commitments — never from memory. Routine is not read, so sleep, " +
          "meals and exercise are not in the answer. `unexpanded` names recurring rules this side " +
          "does not walk: say they are there rather than treating the answer as complete without " +
          "them, and say when a calendar was last pulled if it is stale.",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "integer",
              description: `How many days ahead, counting today. Defaults to ${dueWindowDays}.`,
            },
          },
        },
        call: (given) =>
          whatIsDue(this.#products, { days: asPositiveInteger(given.days) ?? dueWindowDays }),
      },
      {
        name: syncStatusToolName,
        description:
          "How the overnight NTULearn job went, read from the digest its own watchdog wrote: a " +
          "verdict of green, yellow or red with the run's own message. `failed` says what the " +
          "digest blames, and it decides what to say next: on *the session*, say it needs " +
          "re-opening and that only the Owner can do it — there is no tool for it, and never offer " +
          "one. On *something else*, relay the message and never send them to log in. On " +
          "*unclear*, say the cause is not one you can place and point at `runLog`.",
        inputSchema: { type: "object", properties: {} },
        call: () => syncVerdict(this.#products),
      },
      {
        name: announcementsToolName,
        description:
          "What arrived: the announcements a sync has already written under the modules root, " +
          "newest last. It names the module and the title; call `read` from the search tools for " +
          "what one of them says.",
        inputSchema: {
          type: "object",
          properties: {
            hours: {
              type: "integer",
              description: `How far back to look. Defaults to ${announcementsSinceHours}.`,
            },
          },
        },
        call: (given) =>
          announcementsSince(
            modulesRoot(this.#deployment),
            new Date(
              Date.now() -
                (asPositiveInteger(given.hours) ?? announcementsSinceHours) * 60 * 60_000,
            ),
          ),
      },
      {
        name: auditToolName,
        description:
          "Whether the module folders still conform to the contract, from academic-os's own audit. " +
          "On demand only: nothing schedules one, so there is never a fresh observation to " +
          "volunteer drift from. It reads and changes nothing.",
        inputSchema: { type: "object", properties: {} },
        call: async () => {
          const ran = await this.#products.academicOs(["audit"], auditTimeoutMs);
          return { ok: ran.ok, exit: ran.code, report: ran.report, said: ran.said };
        },
      },
      {
        name: syncToolName,
        description:
          "Sync NTULearn now. This **writes**: it spends the saved SSO session and puts files on " +
          "disk, so it happens only on the Owner's own tap. Called without `confirmation` it " +
          "answers with a button — post that button with `message` and say what it will do. A " +
          "message reading `callback_data: <value>` is them tapping it: call this again with that " +
          "value. Never invent, remember or reuse a value, and never run it any other way. The " +
          "run takes minutes: say it has started, and its result arrives in this chat by itself.",
        inputSchema: {
          type: "object",
          properties: {
            confirmation: {
              type: "string",
              description: "The tapped `callback_data` value, verbatim.",
            },
          },
        },
        call: (given) => this.#write({ kind: "sync" }, given.confirmation),
      },
      {
        name: proposeToolName,
        description:
          "Prepare one calendar Proposal. It is private, invisible to the Owner's live calendar " +
          "and trivially discarded, so it needs no confirmation — it is what a Promotion is later " +
          "confirmed against, and it carries academic-os's own conflict check. `item` is its " +
          "versioned input: `kind` is fixed-event, routine-event, timed-milestone or " +
          "all-day-milestone, with `calendarRole` and the times the kind takes. Relay the report, " +
          "including the proposal id, which is what a Promotion names.",
        inputSchema: {
          type: "object",
          properties: {
            item: {
              type: "object",
              description: "The proposal item, in academic-os's own input shape.",
            },
          },
          required: ["item"],
        },
        call: (given) => propose(this.#products, (given.item ?? {}) as Record<string, unknown>),
      },
      {
        name: promoteToolName,
        description:
          "Promote a ready Proposal onto the Owner's calendar. This is the **write** the calendar " +
          "has: like `sync` it answers with a button when called without `confirmation`, and does " +
          "the write only when called again with the value they tapped. Show the conflict check " +
          "the Proposal carried when you ask. academic-os blocks a stale or newly conflicting " +
          "Promotion: relay that refusal rather than proposing again around it.",
        inputSchema: {
          type: "object",
          properties: {
            proposalId: { type: "string", description: "The ready Proposal's own id." },
            confirmation: {
              type: "string",
              description: "The tapped `callback_data` value, verbatim.",
            },
          },
          required: ["proposalId"],
        },
        call: (given) =>
          this.#write(
            { kind: "promotion", proposalId: String(given.proposalId ?? "") },
            given.confirmation,
          ),
      },
    ];
  }

  /**
   * One shape for both writes: no tap, a button; a tap this desk minted, the write; anything else,
   * an expiry — which is what a tap on a message older than this process is, and is answered rather
   * than worked around.
   */
  async #write(write: Write, confirmation: unknown): Promise<unknown> {
    if (typeof confirmation !== "string" || confirmation === "") {
      return {
        confirmed: false,
        button: this.#confirmations.offer(write),
        say: "post this button and say what it will do; the write happens on the tap.",
      } satisfies Unconfirmed;
    }
    const confirmed = this.#confirmations.resolve(confirmation);
    if (confirmed === undefined) {
      return {
        confirmed: false,
        expired: true,
        say: "that tap is not one this desk can resolve, so nothing was written: offer a fresh button.",
      };
    }
    return confirmed.kind === "sync"
      ? this.#startSync()
      : await this.#promote(confirmed.proposalId);
  }

  /**
   * The sync is started and not awaited: it is minutes of downloading and a tool call that waited
   * for it would pass the runtime's whole-turn ceiling. What it did is posted into Academic when it
   * lands, which is the same surface the brief uses and the same one a failure would be read on.
   */
  #startSync(): { confirmed: true; started: boolean; say: string } {
    // One at a time: two runs would spend the one saved session against each other and write the
    // same destinations, and the product's own watchdog lock is not held by an ordinary sync.
    if (this.#syncing !== null) {
      return {
        confirmed: true,
        started: false,
        say: "a sync is already running; what it did arrives in this chat when it lands.",
      };
    }
    const syncing = runSync(this.#products)
      .then((run) => this.#say(syncSaid(run)))
      .catch((error: unknown) => this.#say(`The NTULearn sync did not run: ${reason(error)}`))
      .finally(() => (this.#syncing = null));
    this.#syncing = syncing;
    return {
      confirmed: true,
      started: true,
      say: "the sync has started; it takes minutes, and what it did arrives in this chat.",
    };
  }

  async #promote(proposalId: string): Promise<unknown> {
    const promoted = await promote(this.#products, proposalId);
    return { confirmed: true, ...promoted };
  }

  async #say(text: string): Promise<void> {
    try {
      await ChatSurface.open(this.#deployment).post(chats.academic.id, text);
    } catch (error) {
      console.error(`syrax academic desk: ${text} — and it was not posted: ${reason(error)}`);
    }
  }
}

function syncSaid(run: SyncRun): string {
  const refused =
    run.refused.length === 0
      ? ""
      : ` ${run.refused.length} course${run.refused.length === 1 ? "" : "s"} were refused: ${run.refused
          .map((one) => one.key ?? "one with no key")
          .join(", ")}.`;
  return run.ok
    ? `The NTULearn sync finished over ${run.courses} course${run.courses === 1 ? "" : "s"}.${refused}`
    : `The NTULearn sync did not finish.${refused} It said: ${firstLine(run.said)}`;
}

function firstLine(said: string): string {
  return said.split("\n")[0]!;
}

function asPositiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loopback only, in the lane monitor's shape: the MCP endpoint the Academic agent connects to, and
 * the one path launchd pokes. The brief is a poke rather than a tool because what a model must not
 * decide is when the Owner is written to unasked (ADR-0005).
 */
export async function serveAcademicDesk(
  deployment: Deployment,
): Promise<{ server: Server; port: number; desk: AcademicDesk }> {
  const desk = new AcademicDesk(deployment);
  const endpoint = mcpEndpoint(academicServerName, desk.tools());
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === briefPath && request.method === "POST") {
      void desk
        .brief()
        .then((brief) => send(response, 200, brief))
        .catch((error: unknown) => send(response, 500, { error: reason(error) }));
      return;
    }
    if (path !== mcpPath) {
      send(response, 404, { error: "not found" });
      return;
    }
    void endpoint(request, response);
  });
  await new Promise<void>((resolve) =>
    server.listen(deployment.academicPort, "127.0.0.1", resolve),
  );
  return { server, port: (server.address() as AddressInfo).port, desk };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

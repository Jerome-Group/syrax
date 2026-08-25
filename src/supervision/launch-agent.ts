/**
 * Every launchd job Syrax owns, in the `com.tracearr.server` shape already in the house (ADR-0005):
 * a wrapper rather than the binary as the program, and `KeepAlive` that brings a crash back.
 *
 * Nothing sensitive is in here. `EnvironmentVariables` is refused on ADR-0005's own argument and
 * ADR-0010's: a plist that carried a credential could not also be a tracked example, and the
 * wrapper is where the `PATH` launchd does not provide gets set.
 *
 * None of them names a capture path either. launchd exits `EX_CONFIG` before the job runs when its
 * `StandardOutPath` is on the external volume the logs live on, at a path with a space and without
 * one alike, so each wrapper opens its own capture instead.
 *
 * The schedules are here rather than in the runtime's own scheduler for one reason: one
 * `LaunchAgents` directory is an auditable answer to *what can message me unprompted*, and split
 * across two systems that question stops having a single answer.
 */

import { join } from "node:path";
import type { Deployment } from "../adapter/deployment.ts";

export const gatewayLabel = "com.jerome-group.syrax.gateway";
export const searchLabel = "com.jerome-group.syrax.search";

/** The lane monitor's, kept as `hatch` from when the hatch was all it did: renaming it would be a
 * redeploy for a word, and the name is vocabulary (ADR-0012). */
export const hatchLabel = "com.jerome-group.syrax.hatch";

export const rungWatchLabel = "com.jerome-group.syrax.rung-watch";

export const rungSweepLabel = "com.jerome-group.syrax.rung-sweep";

/** The retrieval report's delivering beat, which posts what a re-embed pass scored and never scores. */
export const retrievalReportLabel = "com.jerome-group.syrax.retrieval-report";

/** The academic desk: the tool layer the Academic chat reaches, resident like the other two. */
export const academicLabel = "com.jerome-group.syrax.academic";

/** The morning brief, which is a poke at the desk and the system's daily heartbeat (ADR-0005). */
export const briefLabel = "com.jerome-group.syrax.brief";

export const incrementalIndexLabel = "com.jerome-group.syrax.index-incremental";
export const fullIndexLabel = "com.jerome-group.syrax.index-full";

/** Long enough that a refusing pre-flight is a slow loop rather than a spin (ADR-0005). */
const throttleIntervalSeconds = 10;

/**
 * `StartCalendarInterval` rather than `StartInterval`, following ntulearn's ADR-0013: a calendar
 * job catches up when the Mac wakes past its time, where an interval one silently skips.
 */
type Calendar = { Day?: number[]; Hour?: number; Minute: number };

const hourly: Calendar = { Minute: 17 };

/**
 * The rung watch, half an hour off the index pass. Spacing the schedules saves one wasted call
 * rather than preventing an outage (ADR-0009), and launchd owning both is what makes it free.
 */
const hourlyOffPeak: Calendar = { Minute: 47 };

/**
 * launchd counts days of the month rather than intervals, so "every third day" is written as the
 * days it lands on. The month boundary is the one place it stretches: the 28th to the 1st is four
 * days in most months and three in a leap February. The pass costs hours, so a day of drift ten
 * times a year is cheaper than the calendar job a truer schedule would need.
 */
/**
 * The sweep, once a day and in the small hours: it spends a real request on every chain rung, and
 * seven a day is the figure ADR-0012 weighed against a rung's allowance. It sits well clear of the
 * full index pass at 04:30, which is hours of work rather than seven calls.
 */
const daily: Calendar = { Hour: 6, Minute: 7 };

/**
 * The retrieval delivery, ten minutes behind the rung watch. Hourly because the run it delivers
 * lands whenever a re-embed pass finishes rather than at an hour anything here can name, and an
 * hourly beat is how a report scored at 09:41 reaches the Owner that morning. It costs one file
 * read on the hours there is nothing to say: a run already delivered is held by the unit's own
 * ledger rather than by the calendar, which is why this can be frequent and still silent.
 */
const hourlyBehindTheWatch: Calendar = { Minute: 57 };

/**
 * Seven in the morning, which is after ntulearn's ~05:00 watchdog and academic-os's 05:00 calendar
 * Refresh and before the Owner's day (#10). The brief is composed from what those two left behind,
 * so it sits behind both rather than racing them.
 */
const morning: Calendar = { Hour: 7, Minute: 0 };

const everyThirdDay: Calendar = { Day: [1, 4, 7, 10, 13, 16, 19, 22, 25, 28], Hour: 4, Minute: 30 };

export function launchAgentPath(home: string, label: string): string {
  return join(home, "Library", "LaunchAgents", `${label}.plist`);
}

export function gatewayLaunchAgentPlist(deployment: Deployment): string {
  return residentUnitPlist(gatewayLabel, deployment.wrapperPath);
}

export function searchLaunchAgentPlist(deployment: Deployment): string {
  return residentUnitPlist(searchLabel, deployment.searchWrapperPath);
}

export function monitorLaunchAgentPlist(deployment: Deployment): string {
  return residentUnitPlist(hatchLabel, deployment.monitorWrapperPath);
}

export function academicLaunchAgentPlist(deployment: Deployment): string {
  return residentUnitPlist(academicLabel, deployment.academicWrapperPath);
}

/**
 * The brief is a poke at the resident desk rather than a job that composes one itself: the desk
 * holds the products, the modules root and the chat surface, and a second composer would post a
 * morning that disagreed with the one the tools answer.
 */
export function briefPlist(deployment: Deployment): string {
  return pokePlist(briefLabel, `http://127.0.0.1:${deployment.academicPort}/brief`, morning);
}

/** The hourly incremental pass and the three-day full one, each a poke at the resident unit. */
export function indexSchedulePlists(deployment: Deployment): Record<string, string> {
  return {
    [incrementalIndexLabel]: indexSchedulePlist(
      incrementalIndexLabel,
      deployment,
      "incremental",
      hourly,
    ),
    [fullIndexLabel]: indexSchedulePlist(fullIndexLabel, deployment, "full", everyThirdDay),
  };
}

/**
 * The rung watch is a poke rather than a second reader: the offset, the rotted set and the chat
 * surface all live in the resident unit, and a second process reading the same log would keep an
 * offset nothing else agrees with.
 */
export function rungWatchPlist(deployment: Deployment): string {
  return pokePlist(
    rungWatchLabel,
    `http://127.0.0.1:${deployment.monitorPort}/watch`,
    hourlyOffPeak,
  );
}

/**
 * The sweep is a poke at the resident unit for the reason the watch is: what a sweep changes is the
 * rotted set, and a second process finding a dead rung would announce one the unit does not hold.
 */
export function rungSweepPlist(deployment: Deployment): string {
  return pokePlist(rungSweepLabel, `http://127.0.0.1:${deployment.monitorPort}/sweep`, daily);
}

/**
 * The delivery is a poke at the resident unit because that unit holds the bot token and the ledger
 * of what has already been delivered. It reads the file the search unit wrote and scores nothing:
 * a second scoring run would ask a different index a different question, and post a number no pass
 * produced (ADR-0007).
 */
export function retrievalReportPlist(deployment: Deployment): string {
  return pokePlist(
    retrievalReportLabel,
    `http://127.0.0.1:${deployment.monitorPort}/retrieval`,
    hourlyBehindTheWatch,
  );
}

function residentUnitPlist(label: string, wrapperPath: string): string {
  return plist(label, [
    programArguments(["/bin/bash", wrapperPath]),
    `	<key>RunAtLoad</key>
	<true/>

	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>

	<key>ThrottleInterval</key>
	<integer>${throttleIntervalSeconds}</integer>`,
  ]);
}

/**
 * A poke rather than a second copy of the pipeline: the pass runs inside the resident unit, so it
 * uses the embedder already in memory instead of loading another 698 MB alongside it (ADR-0005).
 */
function indexSchedulePlist(
  label: string,
  deployment: Deployment,
  pass: string,
  calendar: Calendar,
): string {
  return pokePlist(label, `http://127.0.0.1:${deployment.searchPort}/index/${pass}`, calendar);
}

function pokePlist(label: string, endpoint: string, calendar: Calendar): string {
  return plist(label, [
    programArguments([
      "/usr/bin/curl",
      "--fail",
      "--silent",
      "--show-error",
      "-X",
      "POST",
      endpoint,
    ]),
    `	<key>StartCalendarInterval</key>
${calendarDict(calendar)}`,
  ]);
}

function calendarDict(calendar: Calendar): string {
  const entries = Object.entries(calendar).map(([key, value]) =>
    Array.isArray(value)
      ? `		<key>${key}</key>\n		<array>\n${value.map((one) => `			<integer>${one}</integer>`).join("\n")}\n		</array>`
      : `		<key>${key}</key>\n		<integer>${value}</integer>`,
  );
  return `	<dict>\n${entries.join("\n")}\n	</dict>`;
}

function programArguments(argv: string[]): string {
  const strings = argv.map((one) => `		<string>${escapeForXml(one)}</string>`).join("\n");
  return `	<key>ProgramArguments</key>
	<array>
${strings}
	</array>`;
}

function plist(label: string, sections: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${label}</string>

${sections.join("\n\n")}
</dict>
</plist>
`;
}

function escapeForXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

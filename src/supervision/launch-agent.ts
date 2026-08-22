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
 * launchd counts days of the month rather than intervals, so "every third day" is written as the
 * days it lands on. The month boundary is the one place it stretches: the 28th to the 1st is four
 * days in most months and three in a leap February. The pass costs hours, so a day of drift ten
 * times a year is cheaper than the calendar job a truer schedule would need.
 */
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
  const endpoint = `http://127.0.0.1:${deployment.searchPort}/index/${pass}`;
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

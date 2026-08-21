/**
 * The gateway's LaunchAgent, in the `com.tracearr.server` shape already in the house (ADR-0005):
 * a wrapper rather than the binary as the program, and `KeepAlive` that brings a crash back.
 *
 * Nothing sensitive is in here. `EnvironmentVariables` is refused on ADR-0005's own argument and
 * ADR-0010's: a plist that carried a credential could not also be a tracked example, and the
 * wrapper is where the `PATH` launchd does not provide gets set.
 *
 * It names no capture path either. launchd exits `EX_CONFIG` before the job runs when its
 * `StandardOutPath` is on the external volume the logs live on, at a path with a space and without
 * one alike, so the wrapper opens the capture instead.
 */

import { join } from "node:path";
import type { Deployment } from "../adapter/deployment.ts";

export const gatewayLabel = "com.jerome-group.syrax.gateway";

/** Long enough that a refusing pre-flight is a slow loop rather than a spin (ADR-0005). */
const throttleIntervalSeconds = 10;

export function launchAgentPath(home: string): string {
  return join(home, "Library", "LaunchAgents", `${gatewayLabel}.plist`);
}

export function gatewayLaunchAgentPlist(deployment: Deployment): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${gatewayLabel}</string>

	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>${escapeForXml(deployment.wrapperPath)}</string>
	</array>

	<key>RunAtLoad</key>
	<true/>

	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>

	<key>ThrottleInterval</key>
	<integer>${throttleIntervalSeconds}</integer>
</dict>
</plist>
`;
}

function escapeForXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

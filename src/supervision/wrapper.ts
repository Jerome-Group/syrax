/**
 * What both wrappers are made of. Each unit runs a script rather than its binary (ADR-0005), and
 * the first thing either script does is identical: set the `PATH` launchd does not provide, open
 * the capture launchd cannot open on the external volume the logs live on (ADR-0020), and give the
 * pre-flight the two words it refuses and warns with.
 *
 * Shared rather than copied, because two copies of a capture rotation drift apart silently — the
 * second unit inherits the first one's bug fix only if somebody remembers there are two.
 */

/** launchd hands a job almost no PATH, which is the failure `boot-watchdog` names by comment. */
const path = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** One previous copy is kept beside it, which is what a crash loop needs and no more. */
const captureMaxBytes = 5242880;

/** Every path here is machine-local, and two of them contain a space on the mini. */
export function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The `PATH`, the capture, and `refuse`/`warn`. The capture is opened by the wrapper rather than
 * named in the plist: launchd exits `EX_CONFIG` before the job runs when its `StandardOutPath` is
 * on that volume, at a path with a space and without one alike. Only stderr is kept — a runtime's
 * own log is a superset of its stdout.
 */
export function wrapperPreamble(name: string, logsDir: string, capturePath: string): string {
  return `export PATH=${quoteForShell(path)}

preflight_name=${quoteForShell(name)}
logs_dir=${quoteForShell(logsDir)}
capture=${quoteForShell(capturePath)}
capture_max_bytes=${captureMaxBytes}

start_capture() {
  mkdir -p "$logs_dir" || exit 2
  chmod 700 "$logs_dir" || exit 2
  if [ -f "$capture" ] && [ "$(stat -f %z "$capture")" -ge "$capture_max_bytes" ]; then
    mv -f "$capture" "\${capture%.log}.1.log"
  fi
  : >>"$capture" || exit 2
  chmod 600 "$capture" || exit 2
  exec >/dev/null 2>>"$capture"
}

refuse() {
  echo "$preflight_name: $1" >&2
  exit 2
}

warn() {
  echo "$preflight_name: $1" >&2
}`;
}

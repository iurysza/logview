import { SANITIZED_REDACTION_VERSION } from "@logcayo/engine";

export { SANITIZED_REDACTION_VERSION };

export const SANITIZED_DEVICE_SERIAL = "emulator-5554";

/**
 * Invented AOSP-shaped logcat for the canonical capture profile.
 * Identifiers, packages, and PIDs are fake. The ESC byte is intentional.
 */
export const SANITIZED_LOGCAT = [
	"--------- beginning of main",
	"--------- beginning of system",
	"--------- beginning of crash",
	"1760000100.000001  1186  1186 I Zygote: Process 4321 created for com.example.logview.demo",
	"1760000100.000120  1234  1250 I ActivityManager: Start proc 4321:com.example.logview.demo/u0a42 for activity {com.example.logview.demo/com.example.logview.demo.MainActivity}",
	"1760000100.001001  4321  4321 D logview-demo: session opened",
	"1760000100.002010  4321  4340 I Database: Opening connection",
	"1760000100.002210  4321  4340 D Database: SELECT completed in 12 ms",
	"1760000100.002921  4321  4340 W Database: Retry after lock timeout",
	"\tat com.example.logview.demo.db.Store.lock(Store.java:88)",
	"\tat com.example.logview.demo.db.Store.write(Store.java:41)",
	"1760000100.003019  4321  4340 I Database: Transaction committed",
	"1760000100.003400  4321  4321 E logview-demo: failed to parse token=REDACTED",
	"1760000100.003500  4321  4321 W logview-demo: stray sequence \u001b[31m in payload",
	"1760000100.003600  4321  4321 I logview-demo: café already open",
	"1760000100.003700     1     1 F libc: Fatal signal 11 (SIGSEGV), code 1, fault addr 0x0 in tid 4340 (logview-demo)",
	"not a header line",
	"1760000100.003800  4321  4321 V logview-demo: verbose heartbeat",
	"1760000099.999999  4321  4321 I logview-demo: clock went backward",
	"1760000100.004000  1001  1001 I chatty: uid=10042(u0_a42) expire 4 lines",
	"1760000100.004100  4321  4321 I logview-demo: 日本語 ok",
].join("\n") + "\n";

export const SANITIZED_STDERR = "fake-adb: capture profile threadtime-epoch-usec-v1\n";

export const SANITIZED_ADMITTED_EVENTS = 15;

export const SANITIZED_UNPARSED_EVENTS = 3;

export const SANITIZED_DATABASE_MATCHES = 4;

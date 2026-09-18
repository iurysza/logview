import { join } from "node:path";

export function adbStubPath(name: string): string {
	return join(import.meta.dir, name);
}

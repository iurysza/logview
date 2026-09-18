import { Effect, Either } from "effect";
import { eitherToResult, type Result } from "@logview/core";

export function runSyncResult<A, E>(effect: Effect.Effect<A, E>): Result<A, E> {
	return eitherToResult(Effect.runSync(Effect.either(effect)));
}

export async function runPromiseResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result<A, E>> {
	return eitherToResult(await Effect.runPromise(Effect.either(effect)));
}

export function failConfig(
	field: string,
	message: string,
): Effect.Effect<never, { kind: "invalid-options"; field: string; message: string }> {
	return Effect.fail({ kind: "invalid-options" as const, field, message });
}

export function fromResultEffect<A, E>(result: Result<A, E>): Effect.Effect<A, E> {
	return result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
}

export function mapEitherError<A, E, F>(
	either: Either.Either<A, E>,
	mapError: (error: E) => F,
): Either.Either<A, F> {
	return Either.mapLeft(either, mapError);
}

import { describe, expect, it } from "vitest";
import {
	estimateEntryTokens,
	estimateTokens,
	estimateTotalTokens,
} from "../src/tokens.js";

describe("estimateTokens", () => {
	it("returns 1 for an empty string", () => {
		expect(estimateTokens("")).toBe(1);
	});

	it("returns 1 for strings up to 4 characters", () => {
		expect(estimateTokens("abcd")).toBe(1);
	});

	it("returns 2 for a 5-character string", () => {
		expect(estimateTokens("abcde")).toBe(2);
	});

	it("returns 3 for a 12-character string", () => {
		expect(estimateTokens("hello world!")).toBe(3);
	});

	it("returns the correct estimate for longer strings", () => {
		expect(estimateTokens("a".repeat(100))).toBe(25);
	});

	it("rounds up for non-divisible lengths", () => {
		expect(estimateTokens("abcdefg")).toBe(2);
	});
});

describe("estimateEntryTokens", () => {
	it("combines token estimates for key and value", () => {
		expect(estimateEntryTokens("ab", "abcdefgh")).toBe(3);
	});

	it("returns 2 when both key and value are empty", () => {
		expect(estimateEntryTokens("", "")).toBe(2);
	});

	it("handles a long key with a short value", () => {
		expect(estimateEntryTokens("a".repeat(20), "x")).toBe(6);
	});
});

describe("estimateTotalTokens", () => {
	it("returns 0 for an empty object", () => {
		expect(estimateTotalTokens({})).toBe(0);
	});

	it("returns the correct total for a single entry", () => {
		expect(estimateTotalTokens({ key1: "val1" })).toBe(2);
	});

	it("sums tokens across multiple entries", () => {
		const entries = {
			greeting: "Hello, world!",
			farewell: "Goodbye!",
		};
		expect(estimateTotalTokens(entries)).toBe(10);
	});
});

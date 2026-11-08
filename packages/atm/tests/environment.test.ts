import { describe, expect, test } from "bun:test";
import {
	legacyEnvironmentVariableName,
	readEnvironmentVariable,
} from "../src/environment.js";

describe("readEnvironmentVariable: TFD_* first, then the old ATM_* name", () => {
	test("the old name is the same with ATM_ in place of TFD_", () => {
		expect(legacyEnvironmentVariableName("TFD_R2_BUCKET")).toBe(
			"ATM_R2_BUCKET",
		);
		expect(legacyEnvironmentVariableName("TFD_DIST")).toBe("ATM_DIST");
	});

	test("reads the new name alone", () => {
		expect(readEnvironmentVariable({ TFD_DIST: "/new" }, "TFD_DIST")).toBe(
			"/new",
		);
	});

	test("reads the old name alone", () => {
		expect(readEnvironmentVariable({ ATM_DIST: "/old" }, "TFD_DIST")).toBe(
			"/old",
		);
	});

	test("the new name wins when both are set", () => {
		expect(
			readEnvironmentVariable(
				{ ATM_DIST: "/old", TFD_DIST: "/new" },
				"TFD_DIST",
			),
		).toBe("/new");
	});

	test("an empty value is not a value: an empty TFD_ falls back, two empties are unset", () => {
		expect(
			readEnvironmentVariable({ TFD_DIST: "", ATM_DIST: "/old" }, "TFD_DIST"),
		).toBe("/old");
		expect(
			readEnvironmentVariable({ TFD_DIST: "", ATM_DIST: "" }, "TFD_DIST"),
		).toBeUndefined();
		expect(readEnvironmentVariable({}, "TFD_DIST")).toBeUndefined();
	});

	test("reads only the variable it is asked for", () => {
		expect(
			readEnvironmentVariable(
				{ TFD_R2_BUCKET: "bucket", ATM_R2_PREFIX: "prefix" },
				"TFD_R2_ENDPOINT",
			),
		).toBeUndefined();
	});
});

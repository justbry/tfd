import { defineGolden, readGolden } from "./golden-runner.ts";

defineGolden(readGolden("S5.json"), [
	"ledger",
	"reports",
	"books-shared",
	"books",
	"toasts",
]);

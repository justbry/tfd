import { defineGolden, readGolden } from "./golden-runner.ts";

defineGolden(readGolden("S4.json"), ["members", "panes", "toasts"]);

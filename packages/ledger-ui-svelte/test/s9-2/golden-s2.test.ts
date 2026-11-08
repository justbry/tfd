import { defineGolden, readGolden } from "./golden-runner.ts";

defineGolden(readGolden("S2.json"), ["bookings", "panes", "toasts"]);

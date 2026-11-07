import "../src/app.css";
import { mountApp } from "../src/app/mount.ts";
import { nullLayer, sizeCalendar } from "./null-layer.ts";

const root = document.getElementById("app");
if (root) mountApp(root, { layer: nullLayer, calendar: sizeCalendar });

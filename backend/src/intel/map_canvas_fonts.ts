import fs from "fs";
import path from "path";
import { GlobalFonts } from "@napi-rs/canvas";

let cachedCanvasFamily: string | null = null;

const PREFERRED_SYSTEM_FAMILIES = [
    "Arial",
    "Liberation Sans",
    "DejaVu Sans",
    "Noto Sans",
    "FreeSans",
    "Helvetica",
    "Calibri",
];

function pickSystemFallback(): string {
    const lowerToCanon = new Map<string, string>();
    for (const { family } of GlobalFonts.families) {
        lowerToCanon.set(family.toLowerCase(), family);
    }
    for (const pref of PREFERRED_SYSTEM_FAMILIES) {
        const hit = lowerToCanon.get(pref.toLowerCase());
        if (hit) return hit;
    }
    const skip = /^(Marlett|HoloLens|Segoe MDL2|Wingdings)/i;
    for (const { family } of GlobalFonts.families) {
        if (!skip.test(family)) return family;
    }
    return "Arial";
}

/**
 * Registers fonts used for intel map overlays. Bundled DejaVu is registered as **Arial** so SVG
 * icons whose text uses `font-family="Arial"` resolve on headless/Linux where generic
 * `sans-serif` and missing Arial would otherwise render as tofu.
 *
 * @returns A concrete family name suitable for `ctx.font` (never generic `sans-serif`).
 */
export function ensureIntelMapFontsRegistered(): string {
    if (cachedCanvasFamily !== null) return cachedCanvasFamily;

    const fontsDir = path.join(import.meta.dir, "../../resources/fonts");
    const bundledBold = path.join(fontsDir, "DejaVuSans-Bold.ttf");

    if (fs.existsSync(bundledBold)) {
        const key = GlobalFonts.registerFromPath(bundledBold, "Arial");
        if (key) {
            cachedCanvasFamily = "Arial";
            return cachedCanvasFamily;
        }
    }

    if (GlobalFonts.has("Arial")) {
        cachedCanvasFamily = "Arial";
        return cachedCanvasFamily;
    }

    cachedCanvasFamily = pickSystemFallback();
    return cachedCanvasFamily;
}

/** Builds a `ctx.font` string using a registered concrete family (quoted when needed). */
export function intelMapFontCss(sizePx: number, weight: "bold" | "normal" = "bold"): string {
    const family = ensureIntelMapFontsRegistered();
    const quoted = family.includes(" ") ? `"${family}"` : family;
    return `${weight === "bold" ? "bold " : ""}${sizePx}px ${quoted}`;
}

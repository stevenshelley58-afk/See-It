import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
    style_preset: "neutral",
    automation_enabled: false,
    show_quota: false,
    seeItPrompt: "",
    seeItNowPrompt: "",
    coordinateInstructions: "",
    // See It Now variant prompts - 10 parallel requests with different placement strategies
    seeItNowVariants: [
        { id: "safe-baseline", prompt: "Place the product in the most obvious, low-risk location where it would naturally belong in this room, prioritizing realism, correct scale, and physical plausibility." },
        { id: "conservative-scale", prompt: "Place the product in a natural location and scale it conservatively so it clearly fits the room without feeling visually dominant." },
        { id: "confident-scale", prompt: "Place the product in a natural location and scale it confidently so it feels intentionally sized for the space while remaining physically believable." },
        { id: "dominant-presence", prompt: "Place the product so it reads as a primary visual element in the room, drawing attention while still making physical and spatial sense." },
        { id: "integrated-placement", prompt: "Place the product so it feels integrated with existing elements in the room, allowing natural proximity or partial occlusion if it would realistically occur." },
        { id: "minimal-interaction", prompt: "Place the product in a clean, uncluttered area of the room with minimal interaction from surrounding objects, emphasizing clarity and realism." },
        { id: "alternative-location", prompt: "Place the product in a plausible but less obvious location than the most typical choice, while maintaining realistic scale and placement." },
        { id: "architectural-alignment", prompt: "Place the product aligned cleanly with architectural features in the room such as walls, corners, or vertical planes, emphasizing structural coherence." },
        { id: "spatial-balance", prompt: "Place the product in a position that creates visual balance within the room's composition, avoiding crowding or awkward spacing." },
        { id: "last-resort-realism", prompt: "Choose the placement and scale that would most likely result in a believable real photograph, even if it means a less dramatic composition." }
    ]
};

// GET /api/settings — read settings (spec Routes → Admin API)
export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { settingsJson: true }
    });

    const settings = shop?.settingsJson
        ? JSON.parse(shop.settingsJson)
        : DEFAULT_SETTINGS;

    return json(settings);
};

// POST /api/settings — update settings (spec Routes → Admin API)
export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return json({ error: "invalid_content_type" }, { status: 400 });
    }

    const body = await request.json();
    
    // Merge with existing settings to preserve other fields
    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { settingsJson: true }
    });
    
    const existingSettings = shop?.settingsJson
        ? JSON.parse(shop.settingsJson)
        : DEFAULT_SETTINGS;
    
    const settings = {
        ...existingSettings,
        style_preset: body.style_preset ?? existingSettings.style_preset ?? DEFAULT_SETTINGS.style_preset,
        automation_enabled: body.automation_enabled ?? existingSettings.automation_enabled ?? DEFAULT_SETTINGS.automation_enabled,
        show_quota: body.show_quota ?? existingSettings.show_quota ?? DEFAULT_SETTINGS.show_quota,
        seeItPrompt: body.seeItPrompt !== undefined ? body.seeItPrompt : (existingSettings.seeItPrompt ?? DEFAULT_SETTINGS.seeItPrompt),
        seeItNowPrompt: body.seeItNowPrompt !== undefined ? body.seeItNowPrompt : (existingSettings.seeItNowPrompt ?? DEFAULT_SETTINGS.seeItNowPrompt),
        coordinateInstructions: body.coordinateInstructions !== undefined ? body.coordinateInstructions : (existingSettings.coordinateInstructions ?? DEFAULT_SETTINGS.coordinateInstructions),
        seeItNowVariants: body.seeItNowVariants !== undefined ? body.seeItNowVariants : (existingSettings.seeItNowVariants ?? DEFAULT_SETTINGS.seeItNowVariants)
    };

    await prisma.shop.update({
        where: { shopDomain: session.shop },
        data: { settingsJson: JSON.stringify(settings) }
    });

    return json({ ok: true, settings });
};




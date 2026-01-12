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
    // See It Now variant prompts - each variant gets a unique creative direction
    seeItNowVariants: [
        { id: "balanced", prompt: "Place the product in the most visually balanced and natural position for this room." },
        { id: "left", prompt: "Explore placing the product toward the left side of the scene, where it feels natural." },
        { id: "right", prompt: "Explore placing the product toward the right side of the scene, where it feels natural." },
        { id: "prominent", prompt: "Make the product appear slightly more prominent and larger than typical, as if it's the hero of the space." },
        { id: "subtle", prompt: "Make the product appear slightly more subtle and smaller than typical, letting the room breathe." },
        { id: "creative", prompt: "Try an unexpected but aesthetically pleasing placement that showcases the product beautifully." }
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




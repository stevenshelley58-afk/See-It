import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
    style_preset: "neutral",
    automation_enabled: false,
    show_quota: false,
    seeItPrompt: "",
    coordinateInstructions: ""
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
        coordinateInstructions: body.coordinateInstructions !== undefined ? body.coordinateInstructions : (existingSettings.coordinateInstructions ?? DEFAULT_SETTINGS.coordinateInstructions)
    };

    await prisma.shop.update({
        where: { shopDomain: session.shop },
        data: { settingsJson: JSON.stringify(settings) }
    });

    return json({ ok: true, settings });
};

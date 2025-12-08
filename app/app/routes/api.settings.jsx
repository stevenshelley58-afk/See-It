import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Simple in-memory fallback settings (no persistence available in current schema)
let cachedSettings = {
    style_preset: "neutral",
    automation_enabled: false,
    show_quota: false
};

// GET /api/settings — read settings (spec Routes → Admin API)
export const loader = async ({ request }) => {
    await authenticate.admin(request);
    return json(cachedSettings);
};

// POST /api/settings — update settings (spec Routes → Admin API)
export const action = async ({ request }) => {
    await authenticate.admin(request);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return json({ error: "invalid_content_type" }, { status: 400 });
    }

    const body = await request.json();
    cachedSettings = {
        style_preset: body.style_preset ?? cachedSettings.style_preset,
        automation_enabled: body.automation_enabled ?? cachedSettings.automation_enabled,
        show_quota: body.show_quota ?? cachedSettings.show_quota
    };

    return json({ ok: true, settings: cachedSettings });
};


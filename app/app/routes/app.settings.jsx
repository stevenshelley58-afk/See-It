import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useRouteError, isRouteErrorResponse, useFetcher } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../billing";
import pkg from "../../package.json" with { type: "json" };
import { GEMINI_IMAGE_MODEL_PRO, MODEL_FOR_COMPOSITING } from "../config/ai-models.config";
import { PageShell, Card, Button } from "../components/ui";
import { useEffect, useState } from "react";

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) {
    const shopResponse = await admin.graphql(
      `#graphql
        query {
          shop {
            id
          }
        }
      `
    );
    const shopData = await shopResponse.json();
    const shopifyShopId = shopData.data.shop.id.replace('gid://shopify/Shop/', '');

    shop = await prisma.shop.create({
      data: {
        shopDomain: session.shop,
        shopifyShopId: shopifyShopId,
        accessToken: session.accessToken || "pending",
        plan: PLANS.FREE.id,
        dailyQuota: PLANS.FREE.dailyQuota,
        monthlyQuota: PLANS.FREE.monthlyQuota
      }
    });
  }

  // Check billing status
  let isPro = shop.plan === PLANS.PRO.id;
  try {
    const { hasActivePayment } = await billing.check({
      plans: [PLANS.PRO.name],
      isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false'
    });
    if (hasActivePayment) {
      isPro = true;
    }
  } catch (e) {
    console.error("Billing check failed", e);
  }

  // Auto-generate build info
  const buildTimestamp = process.env.BUILD_TIMESTAMP || new Date().toISOString();
  const version = { 
    app: pkg.version, 
    build: buildTimestamp.slice(0, 10).replace(/-/g, ''),
    date: new Date(buildTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };

  // Fetch settings for prompts
  const settings = shop.settingsJson ? JSON.parse(shop.settingsJson) : {};

  // Default variant prompts - 10 variants focused on accurate placement and sizing
  const defaultVariants = [
    { id: "center-accurate", prompt: "Place the product in the center of the scene at the exact size specified in the product description." },
    { id: "center-larger", prompt: "Place the product in the center of the scene, sized 15% larger than the dimensions specified." },
    { id: "center-smaller", prompt: "Place the product in the center of the scene, sized 15% smaller than the dimensions specified." },
    { id: "left-accurate", prompt: "Place the product toward the left third of the scene at the exact size specified in the product description." },
    { id: "left-larger", prompt: "Place the product toward the left third of the scene, sized 15% larger than the dimensions specified." },
    { id: "right-accurate", prompt: "Place the product toward the right third of the scene at the exact size specified in the product description." },
    { id: "right-larger", prompt: "Place the product toward the right third of the scene, sized 15% larger than the dimensions specified." },
    { id: "far-left", prompt: "Place the product near the left edge of the scene at the exact size specified in the product description." },
    { id: "far-right", prompt: "Place the product near the right edge of the scene at the exact size specified in the product description." },
    { id: "prominent", prompt: "Place the product where it would be most visually prominent, sized 20% larger than specified to emphasize its presence." }
  ];

  return json({
    shop,
    isPro,
    version,
    settings: {
      seeItPrompt: settings.seeItPrompt || "",
      seeItNowPrompt: settings.seeItNowPrompt || "",
      coordinateInstructions: settings.coordinateInstructions || "",
      seeItNowVariants: settings.seeItNowVariants || defaultVariants
    }
  });
};

export default function Settings() {
  const { shop, isPro, version, settings } = useLoaderData();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const [prompts, setPrompts] = useState({
    seeItPrompt: settings.seeItPrompt || "",
    seeItNowPrompt: settings.seeItNowPrompt || "",
    coordinateInstructions: settings.coordinateInstructions || "",
    seeItNowVariants: settings.seeItNowVariants || []
  });
  const [saving, setSaving] = useState(false);

  const handleUpgrade = () => submit({ plan: "PRO" }, { method: "POST", action: "/api/billing" });

  const handleSavePrompts = () => {
    setSaving(true);
    fetcher.submit(
      {
        seeItPrompt: prompts.seeItPrompt,
        seeItNowPrompt: prompts.seeItNowPrompt,
        coordinateInstructions: prompts.coordinateInstructions,
        seeItNowVariants: prompts.seeItNowVariants
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json"
      }
    );
  };

  const updateVariantPrompt = (index, newPrompt) => {
    const newVariants = [...prompts.seeItNowVariants];
    newVariants[index] = { ...newVariants[index], prompt: newPrompt };
    setPrompts({ ...prompts, seeItNowVariants: newVariants });
  };

  const addVariant = () => {
    const newId = `custom_${Date.now()}`;
    setPrompts({
      ...prompts,
      seeItNowVariants: [...prompts.seeItNowVariants, { id: newId, prompt: "" }]
    });
  };

  const removeVariant = (index) => {
    const newVariants = prompts.seeItNowVariants.filter((_, i) => i !== index);
    setPrompts({ ...prompts, seeItNowVariants: newVariants });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setSaving(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <TitleBar title="Settings" />
      <PageShell>
        {/* Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 tracking-tight">
            Settings
          </h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            Configure your See It installation
          </p>
        </div>

        {/* App Info */}
        <Card>
          <div className="divide-y divide-neutral-100">
            <div className="p-4 md:p-6 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">App Version</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5">
                  v{version.app} (Build {version.build})
                </p>
              </div>
              <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">
                Up to date
              </span>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">AI Model</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5">
                  {MODEL_FOR_COMPOSITING}
                </p>
              </div>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">Button Style</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5 truncate">
                  Customize how the See It button appears on your store
                </p>
              </div>
              <Button 
                size="sm" 
                variant="secondary"
                className="flex-shrink-0"
                onClick={() => {
                  // Navigate to theme editor - this would need to be implemented
                  window.location.href = `https://admin.shopify.com/store/${shop.shopDomain}/themes`;
                }}
              >
                Customize
              </Button>
            </div>

            <div className="p-4 md:p-6 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-neutral-900 text-sm md:text-base">Lead Capture</h3>
                <p className="text-xs md:text-sm text-neutral-500 mt-0.5 truncate">
                  Collect email addresses when customers save visualizations
                </p>
              </div>
              <button 
                className="w-11 h-6 bg-neutral-900 rounded-full relative flex-shrink-0"
                onClick={() => {
                  // Toggle functionality would go here
                  console.log("Lead capture toggle");
                }}
              >
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full transition-transform" />
              </button>
            </div>
          </div>
        </Card>

        {/* AI Prompts */}
        <Card>
          <h2 className="font-semibold text-neutral-900 mb-3 md:mb-4 text-sm md:text-base">AI Prompts</h2>
          
          {/* Warning Box */}
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-medium">
              These prompts are sent EXACTLY as written. Nothing is added or modified by the system.
            </p>
          </div>

          <div className="space-y-4">
            {/* See It Prompt */}
            <div>
              <label className="block text-sm font-medium text-neutral-900 mb-1.5">
                See It Prompt
              </label>
              <p className="text-xs text-neutral-500 mb-2">
                This is the prompt used for composite renders. Combined with coordinate instructions and per-product placement prompts.
              </p>
              <textarea
                value={prompts.seeItPrompt}
                onChange={(e) => setPrompts({ ...prompts, seeItPrompt: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                placeholder="Enter the prompt for See It composite renders..."
              />
            </div>

            {/* See It Now Prompt */}
            <div>
              <label className="block text-sm font-medium text-neutral-900 mb-1.5">
                See It Now Prompt
              </label>
              <p className="text-xs text-neutral-500 mb-2">
                This is the prompt used for hero shot renders. Combined with per-product placement prompts.
              </p>
              <textarea
                value={prompts.seeItNowPrompt}
                onChange={(e) => setPrompts({ ...prompts, seeItNowPrompt: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                placeholder="Enter the prompt for See It Now hero shots..."
              />
            </div>

            {/* Coordinate Instructions */}
            <div>
              <label className="block text-sm font-medium text-neutral-900 mb-1.5">
                Coordinate Instructions
              </label>
              <p className="text-xs text-neutral-500 mb-2">
                Optional template for communicating placement coordinates. Use placeholders: <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{X}}"}</code>, <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{Y}}"}</code>, <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{CENTER_X_PX}}"}</code>, <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{CENTER_Y_PX}}"}</code>, <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{WIDTH_PX}}"}</code>, <code className="px-1 py-0.5 bg-neutral-100 rounded">{"{{HEIGHT_PX}}"}</code>
              </p>
              <textarea
                value={prompts.coordinateInstructions}
                onChange={(e) => setPrompts({ ...prompts, coordinateInstructions: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent font-mono text-xs"
                placeholder="Position the product center at ({{CENTER_X_PX}}, {{CENTER_Y_PX}}) pixels."
              />
              <div className="mt-2 text-xs text-neutral-500">
                <p className="font-medium mb-1">Available placeholders:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><code>{"{{X}}"}</code> - Normalized X (0-1)</div>
                  <div><code>{"{{Y}}"}</code> - Normalized Y (0-1)</div>
                  <div><code>{"{{CENTER_X_PX}}"}</code> - Center X in pixels</div>
                  <div><code>{"{{CENTER_Y_PX}}"}</code> - Center Y in pixels</div>
                  <div><code>{"{{WIDTH_PX}}"}</code> - Product width in pixels</div>
                  <div><code>{"{{HEIGHT_PX}}"}</code> - Product height in pixels</div>
                </div>
              </div>
            </div>

            {/* See It Now Variant Prompts */}
            <div className="border-t border-neutral-200 pt-4 mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-neutral-900">
                  See It Now Variants ({prompts.seeItNowVariants?.length || 0})
                </label>
                <button
                  type="button"
                  onClick={addVariant}
                  className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded-md text-neutral-700 transition-colors"
                >
                  + Add Variant
                </button>
              </div>
              <p className="text-xs text-neutral-500 mb-3">
                Each variant generates a separate image with its own creative direction. More variants = more options but longer generation time.
              </p>
              
              <div className="space-y-3">
                {prompts.seeItNowVariants?.map((variant, index) => (
                  <div key={variant.id} className="relative group">
                    <div className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-100 text-neutral-500 text-xs flex items-center justify-center mt-2">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <input
                          type="text"
                          value={variant.prompt}
                          onChange={(e) => updateVariantPrompt(index, e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                          placeholder="Enter creative direction for this variant..."
                        />
                        <span className="text-xs text-neutral-400 mt-1 block">{variant.id}</span>
                      </div>
                      {prompts.seeItNowVariants.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeVariant(index)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-neutral-400 hover:text-red-500"
                          title="Remove variant"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800">
                  <strong>Tip:</strong> Each variant runs in parallel. 6 variants ≈ same time as 1, but uses 6× the quota. 
                  Mix placement (left/right/center) with size (prominent/subtle) for best coverage.
                </p>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSavePrompts}
                disabled={saving}
                variant="primary"
              >
                {saving ? "Saving..." : "Save Prompts"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Billing */}
        <Card>
          <h2 className="font-semibold text-neutral-900 mb-3 md:mb-4 text-sm md:text-base">Billing</h2>
          <div className="p-3 md:p-4 bg-neutral-50 rounded-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="font-medium text-neutral-900 text-sm md:text-base">
                  {isPro ? 'Pro Plan' : 'Free Plan'}
                </div>
                <div className="text-xs md:text-sm text-neutral-500">
                  {shop.dailyQuota} renders/day · {shop.monthlyQuota} renders/month
                </div>
              </div>
              {!isPro && (
                <Button 
                  variant="primary"
                  className="w-full md:w-auto"
                  onClick={handleUpgrade}
                >
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </div>
        </Card>
      </PageShell>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "Error";
  let message = "Something went wrong";

  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    message = error.data?.message || error.statusText;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <>
      <TitleBar title="Settings" />
      <PageShell>
        <Card>
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-red-600">{title}</h1>
              <p className="text-sm text-neutral-600 mt-1">{message}</p>
            </div>
          </div>
        </Card>
      </PageShell>
    </>
  );
}


import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    TextField,
    Button,
    Banner,
    Box,
    InlineStack,
    Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { useState, useCallback, useEffect } from "react";

const DEFAULT_SETTINGS = {
    style_preset: "neutral",
    automation_enabled: false,
    show_quota: false,
    product_context: ""
};

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { settingsJson: true }
    });

    const settings = shop?.settingsJson
        ? JSON.parse(shop.settingsJson)
        : DEFAULT_SETTINGS;

    return json({ settings });
};

export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    
    // Get current settings first
    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { settingsJson: true }
    });

    const currentSettings = shop?.settingsJson
        ? JSON.parse(shop.settingsJson)
        : DEFAULT_SETTINGS;

    // Update with new values
    const settings = {
        ...currentSettings,
        product_context: formData.get("product_context") || ""
    };

    await prisma.shop.update({
        where: { shopDomain: session.shop },
        data: { settingsJson: JSON.stringify(settings) }
    });

    return json({ success: true, message: "Settings saved successfully!" });
};

export default function SettingsPage() {
    const { settings } = useLoaderData();
    const actionData = useActionData();
    const submit = useSubmit();
    const navigation = useNavigation();
    
    const [productContext, setProductContext] = useState(settings.product_context || "");
    const [isDirty, setIsDirty] = useState(false);

    const isLoading = navigation.state === "submitting";

    // Reset dirty state after successful save
    useEffect(() => {
        if (actionData?.success) {
            setIsDirty(false);
        }
    }, [actionData]);

    const handleProductContextChange = useCallback((value) => {
        setProductContext(value);
        setIsDirty(value !== (settings.product_context || ""));
    }, [settings.product_context]);

    const handleSave = useCallback(() => {
        const formData = new FormData();
        formData.append("product_context", productContext);
        submit(formData, { method: "POST" });
    }, [productContext, submit]);

    return (
        <Page>
            <TitleBar title="Settings" />
            
            <BlockStack gap="600">
                {actionData?.success && (
                    <Banner tone="success" onDismiss={() => {}}>
                        {actionData.message}
                    </Banner>
                )}

                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="500">
                                <BlockStack gap="200">
                                    <Text as="h2" variant="headingMd">
                                        🎨 Product Context
                                    </Text>
                                    <Text variant="bodyMd" tone="subdued">
                                        Help the AI understand your products better. This description will be included 
                                        when generating composite images, resulting in more accurate and realistic results.
                                    </Text>
                                </BlockStack>

                                <Divider />

                                <TextField
                                    label="Product Description"
                                    value={productContext}
                                    onChange={handleProductContextChange}
                                    multiline={4}
                                    autoComplete="off"
                                    placeholder="e.g., Large floor-standing mirrors with ornate gold frames. These are full-length mirrors designed to lean against walls in living rooms or bedrooms."
                                    helpText="Describe what your products are, their typical size, and how they're meant to be displayed. Be specific!"
                                />

                                <Box
                                    background="bg-surface-secondary"
                                    padding="400"
                                    borderRadius="200"
                                >
                                    <BlockStack gap="200">
                                        <Text variant="headingSm">💡 Tips for better results:</Text>
                                        <BlockStack gap="100">
                                            <Text variant="bodySm">• Mention the product type (e.g., "floor mirrors", "wall art", "furniture")</Text>
                                            <Text variant="bodySm">• Include typical dimensions or scale (e.g., "large", "6 feet tall")</Text>
                                            <Text variant="bodySm">• Describe how it's displayed (e.g., "leaning against wall", "mounted", "standing")</Text>
                                            <Text variant="bodySm">• Note any special features (e.g., "ornate gold frame", "modern minimalist")</Text>
                                        </BlockStack>
                                    </BlockStack>
                                </Box>

                                <InlineStack align="end">
                                    <Button
                                        variant="primary"
                                        onClick={handleSave}
                                        loading={isLoading}
                                        disabled={!isDirty}
                                    >
                                        Save Settings
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <Card>
                            <BlockStack gap="300">
                                <Text as="h2" variant="headingMd">
                                    📖 How it works
                                </Text>
                                <Text variant="bodySm" tone="subdued">
                                    When a customer generates a visualization, the AI uses your product 
                                    description to better understand context and create more realistic composites.
                                </Text>
                                <Divider />
                                <Text variant="bodySm" tone="subdued">
                                    For example, if you sell floor mirrors, telling the AI they are "large 
                                    floor-standing mirrors" helps it understand the scale and positioning 
                                    in the room photo.
                                </Text>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}


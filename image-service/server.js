console.log("Starting Image Service...");

// CRITICAL: Load env vars FIRST, before any modules that use process.env
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

let prepareProduct, cleanupRoom, compositeScene;
try {
    const geminiModule = await import('./gemini.js');
    prepareProduct = geminiModule.prepareProduct;
    cleanupRoom = geminiModule.cleanupRoom;
    compositeScene = geminiModule.compositeScene;
    console.log("Gemini module loaded successfully");
} catch (error) {
    console.error("Failed to load Gemini module:", error);
}


const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Auth Middleware
app.use((req, res, next) => {
    // Skip auth for healthcheck
    if (req.path === '/healthz' || req.path === '/') return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    if (token !== process.env.IMAGE_SERVICE_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
});

// Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

const SERVICE_VERSION = '2.1.0-eraser-mask';

// Root route for Cloud Run default health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'see-it-image-service', 
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString()
    });
});

app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/product/prepare', async (req, res) => {
    try {
        const { source_image_url, shop_id, product_id, asset_id, prompt, model } = req.body;
        console.log(`Processing prepare for ${shop_id}/${product_id}/${asset_id}`);

        const prepared_image_url = await prepareProduct(source_image_url, shop_id, product_id, asset_id);

        res.json({ prepared_image_url });
    } catch (error) {
        console.error('Error in /product/prepare:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.post('/room/cleanup', async (req, res) => {
    try {
        const { room_image_url, mask_data_url } = req.body;
        
        if (!room_image_url || !mask_data_url) {
            return res.status(400).json({ 
                error: 'Bad Request', 
                message: 'room_image_url and mask_data_url are required' 
            });
        }
        
        console.log('Processing room cleanup with drawn mask');

        const cleaned_room_image_url = await cleanupRoom(room_image_url, mask_data_url);

        res.json({ cleaned_room_image_url });
    } catch (error) {
        console.error('Error in /room/cleanup:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.post('/scene/composite', async (req, res) => {
    try {
        const { prepared_product_image_url, room_image_url, placement, prompt, model } = req.body;
        console.log('Processing scene composite');

        const image_url = await compositeScene(
            prepared_product_image_url,
            room_image_url,
            placement,
            prompt ? prompt.style_preset : 'neutral'
        );

        res.json({ image_url });
    } catch (error) {
        console.error('Error in /scene/composite:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Image Service listening on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Gemini API Key: ${process.env.GEMINI_API_KEY ? 'Set' : 'NOT SET'}`);
});

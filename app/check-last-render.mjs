import pg from 'pg';
const { Client } = pg;

const DATABASE_PUBLIC_URL = process.env.DATABASE_PUBLIC_URL || 
    'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway';

const client = new Client({
    connectionString: DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    console.log('Connected to database\n');

    // Get the most recent render_prompt_built event
    const result = await client.query(`
        SELECT 
            id,
            event_type,
            payload,
            timestamp
        FROM prep_events 
        WHERE event_type = 'render_prompt_built'
        ORDER BY timestamp DESC
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        console.log('No render_prompt_built events found');
        await client.end();
        return;
    }

    const event = result.rows[0];
    const payload = event.payload;

    console.log('=== LAST RENDER TO GEMINI ===\n');
    console.log('Timestamp:', event.timestamp);
    console.log('Job ID:', payload.renderJobId);
    console.log('Model:', payload.model);
    console.log('Aspect Ratio:', payload.aspectRatio);
    console.log('\n--- PLACEMENT ---');
    console.log(JSON.stringify(payload.placement, null, 2));
    
    console.log('\n--- PROMPT SENT TO GEMINI ---');
    console.log(payload.prompt);
    
    console.log('\n--- PRODUCT DIMENSIONS ---');
    console.log('Resized Width:', payload.productResizedWidth, 'px');
    console.log('Resized Height:', payload.productResizedHeight, 'px');
    
    console.log('\n--- CANONICAL ROOM ---');
    console.log('Key:', payload.canonicalRoomKey || 'N/A');
    console.log('Width:', payload.canonicalRoomWidth || 'N/A', 'px');
    console.log('Height:', payload.canonicalRoomHeight || 'N/A', 'px');
    console.log('Ratio:', payload.canonicalRoomRatio || 'N/A');
    
    console.log('\n--- GEMINI URI USAGE ---');
    console.log('Room URI:', payload.useRoomUri ? 'YES' : 'NO');
    console.log('Product URI:', payload.useProductUri ? 'YES' : 'NO');
    
    if (payload.placementPrompt) {
        console.log('\n--- PLACEMENT PROMPT ---');
        console.log(payload.placementPrompt);
    }

    await client.end();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

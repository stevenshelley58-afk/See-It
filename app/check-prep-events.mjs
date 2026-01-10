import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    // Get the asset ID first
    const asset = await client.query(`
        SELECT id, updated_at, created_at 
        FROM product_assets 
        WHERE product_id = '9877007368477'
    `);
    
    console.log('=== ASSET INFO ===');
    console.log('Asset ID:', asset.rows[0]?.id);
    console.log('Created:', asset.rows[0]?.created_at);
    console.log('Updated:', asset.rows[0]?.updated_at);
    
    if (asset.rows[0]?.id) {
        // Get prep events for this asset
        const events = await client.query(`
            SELECT event_type, timestamp, payload 
            FROM prep_events 
            WHERE asset_id = $1
            ORDER BY timestamp DESC
            LIMIT 20
        `, [asset.rows[0].id]);
        
        console.log('\n=== PREP EVENTS ===');
        for (const event of events.rows) {
            console.log(`\n${event.timestamp.toISOString()} - ${event.event_type}`);
            // Show relevant payload fields
            const payload = event.payload;
            if (payload.before || payload.after) {
                console.log('  Before:', payload.before);
                console.log('  After:', payload.after);
            }
        }
    }
    
    await client.end();
}

main().catch(console.error);

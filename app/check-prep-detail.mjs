import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    const assetId = '7f4cf3c6-429e-4e74-ba63-93f787d5c3bf';
    
    // Get ALL prep events with full payload
    const events = await client.query(`
        SELECT event_type, timestamp, actor_type, payload 
        FROM prep_events 
        WHERE asset_id = $1
        ORDER BY timestamp ASC
    `, [assetId]);
    
    console.log('=== FULL PREP EVENT HISTORY ===\n');
    
    let prevTime = null;
    for (const event of events.rows) {
        const time = event.timestamp;
        let duration = '';
        if (prevTime) {
            const diffMs = time - prevTime;
            const diffSec = Math.round(diffMs / 1000);
            duration = ` (+${diffSec}s from prev)`;
        }
        
        console.log(`${time.toISOString()} - ${event.event_type}${duration}`);
        console.log(`  Actor: ${event.actor_type}`);
        console.log(`  Payload:`, JSON.stringify(event.payload, null, 4));
        console.log('');
        
        prevTime = time;
    }
    
    // Also check the product asset for any model info
    const asset = await client.query(`
        SELECT prep_strategy, prompt_version, gemini_file_uri, gemini_file_expires_at
        FROM product_assets 
        WHERE id = $1
    `, [assetId]);
    
    console.log('\n=== ASSET MODEL INFO ===');
    console.log(asset.rows[0]);
    
    await client.end();
}

main().catch(console.error);

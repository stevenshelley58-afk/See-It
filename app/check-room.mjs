import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    // Get the latest room session
    const r = await client.query(`
        SELECT id, gemini_file_uri, gemini_file_expires_at, canonical_room_url, created_at
        FROM room_sessions 
        WHERE shop_id = 'ddd3597a-7070-442b-9c8e-f525e8077916'
        ORDER BY created_at DESC
        LIMIT 3
    `);
    
    console.log('Recent room sessions:');
    for (const row of r.rows) {
        console.log('---');
        console.log('ID:', row.id);
        console.log('Gemini URI:', row.gemini_file_uri?.substring(0, 80) || 'NULL');
        console.log('Expires:', row.gemini_file_expires_at);
        console.log('Created:', row.created_at);
    }
    
    await client.end();
}

main().catch(console.error);

import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    // Check the product that was just enabled
    const result = await client.query(`
        SELECT product_id, product_title, status, enabled, source_image_url, prepared_image_key 
        FROM product_assets 
        WHERE product_id = '9877007368477'
    `);
    
    console.log('Product 9877007368477:');
    console.log(JSON.stringify(result.rows[0], null, 2));
    
    // Also check how many are now enabled
    const enabledCount = await client.query(`
        SELECT COUNT(*) as enabled_count 
        FROM product_assets 
        WHERE enabled = true
    `);
    console.log('\nEnabled products:', enabledCount.rows[0].enabled_count);
    
    await client.end();
}

main().catch(console.error);

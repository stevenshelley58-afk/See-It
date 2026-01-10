import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    const r = await client.query(`
        UPDATE product_assets 
        SET status = 'preparing', retry_count = 0 
        WHERE product_id = '9877007368477' 
        RETURNING id, product_id, status
    `);
    
    console.log('Updated:', r.rows[0]);
    console.log('Product will be re-prepared with the new trim logic.');
    
    await client.end();
}

main().catch(console.error);

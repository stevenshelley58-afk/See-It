import pg from 'pg';
const { Client } = pg;

// Use public URL for local access
const DATABASE_PUBLIC_URL = process.env.DATABASE_PUBLIC_URL || 
    'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway';

const client = new Client({
    connectionString: DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    console.log('Connected to database');

    // Find BHM shop (bohoem58 is the Shopify domain behind bhm.com.au)
    console.log('\n=== SEARCHING FOR BOHOEM SHOP ===');
    const shopsResult = await client.query(`
        SELECT id, shop_domain, plan, created_at 
        FROM shops 
        WHERE shop_domain ILIKE '%bohoem%'
    `);
    
    if (shopsResult.rows.length === 0) {
        // Show all shops
        const allShops = await client.query('SELECT id, shop_domain FROM shops LIMIT 10');
        console.log('No BHM shop found. All shops:');
        console.log(allShops.rows);
        await client.end();
        return;
    }

    console.log('BHM Shop found:', shopsResult.rows[0]);
    const shopId = shopsResult.rows[0].id;

    // Get all product assets
    console.log('\n=== PRODUCT ASSETS ===');
    const assetsResult = await client.query(`
        SELECT 
            id,
            product_id,
            product_title,
            status,
            enabled,
            prepared_image_url,
            prepared_image_key,
            source_image_url,
            error_message,
            updated_at
        FROM product_assets 
        WHERE shop_id = $1
        ORDER BY updated_at DESC
        LIMIT 20
    `, [shopId]);

    console.log(`Found ${assetsResult.rows.length} product assets`);
    
    for (const asset of assetsResult.rows) {
        console.log('\n---', asset.product_title || 'Unknown', '---');
        console.log('  Product ID:', asset.product_id);
        console.log('  Status:', asset.status);
        console.log('  Enabled:', asset.enabled);
        console.log('  Has Prepared URL:', !!asset.prepared_image_url);
        console.log('  Has Prepared Key:', !!asset.prepared_image_key);
        if (asset.prepared_image_key) {
            console.log('  Key:', asset.prepared_image_key);
        }
        if (asset.error_message) {
            console.log('  ERROR:', asset.error_message);
        }
    }

    // Look for mirrors specifically
    console.log('\n=== MIRROR PRODUCTS ===');
    const mirrorAssets = assetsResult.rows.filter(a => 
        a.product_title?.toLowerCase().includes('mirror') ||
        a.product_title?.toLowerCase().includes('sundar')
    );
    
    if (mirrorAssets.length > 0) {
        console.log(JSON.stringify(mirrorAssets, null, 2));
    } else {
        console.log('No mirror products found in recent 20');
    }

    // Search ALL products for sundar
    console.log('\n=== SEARCHING ALL PRODUCTS FOR "SUNDAR" ===');
    const sundarSearch = await client.query(`
        SELECT product_id, product_title, status, enabled 
        FROM product_assets 
        WHERE shop_id = $1 AND (
            product_title ILIKE '%sundar%' OR
            product_title ILIKE '%detailed%mirror%'
        )
    `, [shopId]);
    console.log('Sundar search results:', sundarSearch.rows);

    // Count total products
    const totalCount = await client.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE enabled = true) as enabled_count,
               COUNT(*) FILTER (WHERE status = 'ready') as ready_count
        FROM product_assets WHERE shop_id = $1
    `, [shopId]);
    console.log('\n=== PRODUCT STATS ===');
    console.log(totalCount.rows[0]);

    // Check recent render jobs
    console.log('\n=== RECENT RENDER JOBS ===');
    const jobsResult = await client.query(`
        SELECT 
            id,
            product_id,
            status,
            image_url,
            image_key,
            error_message,
            created_at
        FROM render_jobs 
        WHERE shop_id = $1
        ORDER BY created_at DESC
        LIMIT 10
    `, [shopId]);

    for (const job of jobsResult.rows) {
        console.log('\n--- Job', job.id.slice(0,8), '---');
        console.log('  Status:', job.status);
        console.log('  Product:', job.product_id);
        console.log('  Has Image:', !!job.image_url || !!job.image_key);
        if (job.error_message) {
            console.log('  ERROR:', job.error_message);
        }
    }

    // Check room sessions
    console.log('\n=== ROOM SESSIONS ===');
    const roomsResult = await client.query(`
        SELECT * FROM room_sessions 
        WHERE shop_id = $1
        ORDER BY created_at DESC
        LIMIT 5
    `, [shopId]);
    
    console.log(`Found ${roomsResult.rows.length} room sessions`);
    for (const room of roomsResult.rows) {
        console.log('\n--- Room', room.id.slice(0,8), '---');
        console.log('  Original Key:', room.original_room_image_key || 'N/A');
        console.log('  Cleaned Key:', room.cleaned_room_image_key || 'N/A');
        console.log('  Created:', room.created_at);
        console.log('  Expires:', room.expires_at);
    }

    await client.end();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

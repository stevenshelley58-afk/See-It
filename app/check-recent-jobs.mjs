import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:VnOIrOlSbtqCECJfMwpPOisZTndsqnxO@maglev.proxy.rlwy.net:21199/railway',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    
    // Get most recent render jobs for the Sundar mirror
    const jobs = await client.query(`
        SELECT id, status, error_message, image_key, created_at 
        FROM render_jobs 
        WHERE product_id = '9877007368477'
        ORDER BY created_at DESC 
        LIMIT 10
    `);
    
    console.log('=== RECENT RENDER JOBS FOR SUNDAR MIRROR ===');
    for (const job of jobs.rows) {
        console.log(`\n${job.created_at.toISOString()} - ${job.status}`);
        if (job.error_message) console.log('  ERROR:', job.error_message);
        if (job.image_key) console.log('  Image:', job.image_key);
    }
    
    // Check for any recent render jobs across all products
    const allRecent = await client.query(`
        SELECT product_id, status, error_message, created_at 
        FROM render_jobs 
        ORDER BY created_at DESC 
        LIMIT 5
    `);
    
    console.log('\n\n=== MOST RECENT RENDER JOBS (ALL PRODUCTS) ===');
    for (const job of allRecent.rows) {
        console.log(`${job.created_at.toISOString()} - Product ${job.product_id} - ${job.status}`);
        if (job.error_message) console.log('  ERROR:', job.error_message);
    }
    
    await client.end();
}

main().catch(console.error);

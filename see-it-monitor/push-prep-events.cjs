const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    console.log('Connected to database');

    // Check if prep_events table exists
    const checkTable = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'prep_events'
    );
  `);

    if (checkTable.rows[0].exists) {
        console.log('prep_events table already exists');
    } else {
        console.log('Creating prep_events table...');
        await client.query(`
      CREATE TABLE IF NOT EXISTS prep_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        actor_type VARCHAR(20) NOT NULL,
        actor_id TEXT,
        event_type VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS prep_events_asset_idx ON prep_events(asset_id);
      CREATE INDEX IF NOT EXISTS prep_events_shop_timestamp_idx ON prep_events(shop_id, timestamp);
      CREATE INDEX IF NOT EXISTS prep_events_product_idx ON prep_events(product_id);
      CREATE INDEX IF NOT EXISTS prep_events_event_type_idx ON prep_events(event_type);
    `);
        console.log('prep_events table created successfully!');
    }

    await client.end();
    console.log('Done');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

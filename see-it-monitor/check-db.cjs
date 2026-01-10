const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    await client.connect();
    console.log('Connected to database\n');

    // List all tables
    const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);

    console.log('Existing tables:');
    tables.rows.forEach(row => console.log('  -', row.table_name));

    // Check prep_events structure
    const columns = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'prep_events'
    ORDER BY ordinal_position;
  `);

    console.log('\nprep_events columns:');
    columns.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));

    // Try a simple query on prep_events
    console.log('\nTesting query on prep_events...');
    const count = await client.query('SELECT COUNT(*) FROM prep_events');
    console.log('prep_events row count:', count.rows[0].count);

    await client.end();
    console.log('\nDone');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

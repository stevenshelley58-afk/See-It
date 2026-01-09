/**
 * Database Migration API
 * One-time endpoint to apply database schema
 * Should be called once after deployment to set up the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';

// Simple auth - require a secret token
const MIGRATE_SECRET = process.env.MIGRATE_SECRET;

export async function POST(request: NextRequest) {
  try {
    if (!MIGRATE_SECRET) {
      return NextResponse.json(
        { error: 'MIGRATE_SECRET is not configured' },
        { status: 500 }
      );
    }

    // Check auth token
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || request.nextUrl.searchParams.get('token');
    
    if (token !== MIGRATE_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide ?token=<MIGRATE_SECRET> or Authorization: Bearer <MIGRATE_SECRET>' },
        { status: 401 }
      );
    }

    // Read migration SQL file
    const migrationPath = join(process.cwd(), 'drizzle', '0000_windy_giant_girl.sql');
    let migrationSQL: string;
    
    try {
      migrationSQL = readFileSync(migrationPath, 'utf-8');
    } catch (error) {
      return NextResponse.json(
        { error: `Failed to read migration file: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 500 }
      );
    }

    // Split by statement breakpoints and execute each statement
    // Handle both formats: "--> statement-breakpoint" on its own line and inline
    const parts = migrationSQL.split(/--> statement-breakpoint/);
    const statements: string[] = [];

    for (const part of parts) {
      // Split by semicolons to get individual SQL statements
      const lines = part.trim().split('\n');
      let currentStatement = '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip comment lines
        if (trimmed.startsWith('--') || trimmed.length === 0) {
          continue;
        }
        
        currentStatement += line + '\n';
        
        // If line ends with semicolon, we have a complete statement
        if (trimmed.endsWith(';')) {
          const stmt = currentStatement.trim();
          if (stmt.length > 10) {
            statements.push(stmt);
          }
          currentStatement = '';
        }
      }
      
      // Add any remaining statement
      if (currentStatement.trim().length > 10) {
        statements.push(currentStatement.trim());
      }
    }

    const results: Array<{ statement: string; success: boolean; error?: string }> = [];

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
        const preview = statement.substring(0, 80).replace(/\s+/g, ' ');
        results.push({ statement: preview + '...', success: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const preview = statement.substring(0, 80).replace(/\s+/g, ' ');
        // If table/index already exists, that's okay
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate') || errorMsg.includes('relation') && errorMsg.includes('exists')) {
          results.push({ statement: preview + '...', success: true, error: 'Already exists (skipped)' });
        } else {
          results.push({ statement: preview + '...', success: false, error: errorMsg });
        }
      }
    }

    // Verify tables were created
    const tablesResult = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables = (tablesResult.rows as Array<{ table_name: string }>).map(r => r.table_name);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: failCount === 0,
      message: `Migration completed: ${successCount} statements succeeded, ${failCount} failed`,
      results,
      tables: tables,
      tableCount: tables.length,
    });
  } catch (error) {
    console.error('[Migrate API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Migration failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check migration status
export async function GET() {
  try {
    const tablesResult = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables = (tablesResult.rows as Array<{ table_name: string }>).map(r => r.table_name);

    // Check if key tables exist
    const expectedTables = [
      'sessions', 
      'analytics_events', 
      'shops', 
      'errors', 
      'ai_requests',
      // Flight Recorder tables
      'run_nodes',
      'run_signals',
      'artifacts',
      'artifact_edges',
      'model_calls',
      'archetypes',
      'archetype_matches',
      'archetype_tests'
    ];
    const missingTables = expectedTables.filter(t => !tables.includes(t));

    return NextResponse.json({
      migrated: missingTables.length === 0,
      tables,
      tableCount: tables.length,
      missingTables,
      expectedTables,
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Failed to check migration status',
        details: error instanceof Error ? error.message : 'Unknown error',
        migrated: false,
      },
      { status: 500 }
    );
  }
}

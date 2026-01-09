import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { archetypeTests, runSignals, artifacts, sessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface TestRunRequest {
  archetypeId: string;
  testId: string;
  sessionId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as TestRunRequest;
    const { archetypeId, testId, sessionId } = body;

    if (!archetypeId || !testId || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: archetypeId, testId, sessionId' },
        { status: 400 }
      );
    }

    // Get test definition
    const testRecords = await db
      .select()
      .from(archetypeTests)
      .where(eq(archetypeTests.id, testId))
      .limit(1);

    if (testRecords.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }

    const test = testRecords[0];
    if (test.archetypeId !== archetypeId) {
      return NextResponse.json(
        { error: 'Test does not belong to archetype' },
        { status: 400 }
      );
    }

    // Get session
    const sessionRecords = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);

    if (sessionRecords.length === 0) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    const session = sessionRecords[0];

    // Get test definition
    const testDef = test.testDefinition as {
      type?: string;
      check?: string;
      expected?: unknown;
      nodeKey?: string;
    } | null;

    // Run test based on type
    let passed = false;
    let evidence: Record<string, unknown> = {};

    if (testDef?.type === 'signal_check') {
      // Check if a signal exists
      const nodeKey = testDef.nodeKey || 'ui:render_final';
      const checkRaw = testDef.check || 'observed';
      const allowedSignals = ['intended', 'attempted', 'produced', 'observed'] as const;
      const check = allowedSignals.includes(checkRaw as (typeof allowedSignals)[number])
        ? (checkRaw as (typeof allowedSignals)[number])
        : 'observed';

      const signals = await db
        .select()
        .from(runSignals)
        .where(
          and(
            eq(runSignals.sessionId, session.id),
            eq(runSignals.nodeKey, nodeKey),
            eq(runSignals.signalType, check)
          )
        )
        .limit(1);

      passed = signals.length > 0;
      evidence = {
        nodeKey,
        check,
        signalFound: signals.length > 0,
        signalTimestamp: signals[0]?.timestamp || null,
      };
    } else if (testDef?.type === 'artifact_check') {
      // Check if an artifact exists
      const nodeKey = testDef.nodeKey || 'ui:render_final';
      const artifactType = testDef.check || 'final_render';

      const artifactRecords = await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.sessionId, session.id),
            eq(artifacts.nodeKey, nodeKey),
            eq(artifacts.type, artifactType)
          )
        )
        .limit(1);

      passed = artifactRecords.length > 0;
      evidence = {
        nodeKey,
        artifactType,
        artifactFound: artifactRecords.length > 0,
        artifactId: artifactRecords[0]?.artifactId || null,
      };
    } else if (testDef?.type === 'outcome_check') {
      // Check session outcome
      const expectedOutcome = testDef.expected || 'ok';
      passed = session.outcome === expectedOutcome;
      evidence = {
        expectedOutcome,
        actualOutcome: session.outcome,
      };
    } else {
      // Default: always fail unknown test types
      passed = false;
      evidence = { error: 'Unknown test type' };
    }

    // Create evidence artifact (store test result)
    const evidenceArtifactId = `test_evidence_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    await db.insert(artifacts).values({
      artifactId: evidenceArtifactId,
      sessionId: session.id,
      nodeKey: testDef?.nodeKey || null,
      type: 'test_evidence',
      storageKey: null,
      sha256: null,
    });

    // Insert test result as a signal
    await db.insert(runSignals).values({
      sessionId: session.id,
      nodeKey: testDef?.nodeKey || 'test',
      signalType: passed ? 'produced' : 'attempted',
      timestamp: new Date(),
      payload: {
        testId,
        testName: test.testName,
        passed,
        evidence,
        evidenceArtifactId,
      },
    });

    return NextResponse.json({
      success: true,
      passed,
      evidence,
      evidenceArtifactId,
    });
  } catch (error) {
    console.error('[Test Run API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to run test',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Archetype Matcher
 * Deterministic matching from divergence reason tokens
 */

import { db } from '@/lib/db/client';
import { archetypes, archetypeMatches, sessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

interface DivergenceTokens {
  nodeKey: string;
  outcome: string;
  errorCode?: string;
  errorMessage?: string;
  firstDivergenceNodeKey?: string;
}

interface ArchetypeSignature {
  tokens?: string[];
  nodeKeys?: string[];
  outcomes?: string[];
  errorCodes?: string[];
  weights?: Record<string, number>;
}

/**
 * Extract tokens from divergence data
 */
function extractTokens(divergence: DivergenceTokens): string[] {
  const tokens: string[] = [];

  // Add node key
  if (divergence.nodeKey) {
    tokens.push(divergence.nodeKey.toLowerCase());
  }

  // Add outcome
  if (divergence.outcome) {
    tokens.push(divergence.outcome.toLowerCase());
  }

  // Add error code
  if (divergence.errorCode) {
    tokens.push(divergence.errorCode.toLowerCase());
    // Split error code by underscores/camelCase
    tokens.push(...divergence.errorCode.split(/[_\s]+/).map(t => t.toLowerCase()));
  }

  // Add error message words (first 10 words)
  if (divergence.errorMessage) {
    const words = divergence.errorMessage
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 10)
      .filter(w => w.length > 3); // Filter short words
    tokens.push(...words);
  }

  // Add first divergence node key
  if (divergence.firstDivergenceNodeKey) {
    tokens.push(divergence.firstDivergenceNodeKey.toLowerCase());
  }

  return [...new Set(tokens)]; // Remove duplicates
}

/**
 * Calculate match confidence between tokens and signature
 */
function calculateConfidence(
  tokens: string[],
  signature: ArchetypeSignature
): number {
  if (!signature.tokens || signature.tokens.length === 0) {
    return 0;
  }

  const signatureTokens = new Set(signature.tokens.map(t => t.toLowerCase()));
  const tokenSet = new Set(tokens);

  // Count matches
  let matches = 0;
  let totalWeight = 0;

  for (const token of tokenSet) {
    if (signatureTokens.has(token)) {
      const weight = signature.weights?.[token] || 1.0;
      matches += weight;
      totalWeight += weight;
    }
  }

  // Normalize by signature size
  const signatureWeight = signature.tokens.reduce(
    (sum, t) => sum + (signature.weights?.[t] || 1.0),
    0
  );

  if (signatureWeight === 0) return 0;

  // Confidence is matches / signature weight
  return Math.min(matches / signatureWeight, 1.0);
}

/**
 * Match a session to archetypes
 */
export async function matchSessionToArchetypes(sessionId: string): Promise<void> {
  // Get session
  const sessionRecords = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .limit(1);

  if (sessionRecords.length === 0) return;

  const session = sessionRecords[0];

  // Skip if no divergence
  if (!session.firstDivergenceNodeKey || !session.outcome) {
    return;
  }

  // Build divergence tokens
  const divergence: DivergenceTokens = {
    nodeKey: session.firstDivergenceNodeKey,
    outcome: session.outcome,
    firstDivergenceNodeKey: session.firstDivergenceNodeKey,
  };

  // Get error info if available
  // TODO: Query errors table for this session

  const tokens = extractTokens(divergence);

  // Get all archetypes
  const allArchetypes = await db.select().from(archetypes);

  // Match against each archetype
  for (const archetype of allArchetypes) {
    const signature = archetype.signatureRules as ArchetypeSignature | null;
    if (!signature) continue;

    const confidence = calculateConfidence(tokens, signature);

    // Only create match if confidence > 0.3
    if (confidence > 0.3) {
      // Check if match already exists
      const existingMatches = await db
        .select()
        .from(archetypeMatches)
        .where(
          and(
            eq(archetypeMatches.sessionId, session.id),
            eq(archetypeMatches.archetypeId, archetype.id)
          )
        )
        .limit(1);

      if (existingMatches.length === 0) {
        // Create match
        await db.insert(archetypeMatches).values({
          sessionId: session.id,
          archetypeId: archetype.id,
          confidence,
          matchedTokens: tokens.filter(t =>
            signature.tokens?.some(st => st.toLowerCase() === t)
          ),
          decidedBy: 'auto',
        });
      } else {
        // Update existing match if confidence is higher
        const existing = existingMatches[0];
        if (confidence > existing.confidence) {
          await db
            .update(archetypeMatches)
            .set({
              confidence,
              matchedTokens: tokens.filter(t =>
                signature.tokens?.some(st => st.toLowerCase() === t)
              ),
            })
            .where(eq(archetypeMatches.id, existing.id));
        }
      }
    }
  }
}

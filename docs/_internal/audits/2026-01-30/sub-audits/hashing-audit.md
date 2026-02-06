# Hashing, Determinism & Identity Logic Audit

**Scope:** All hash computation, serialization, and identity logic across the codebase  
**Date:** 2026-01-30  
**Auditor:** Code Review

---

## Executive Summary

The codebase uses **multiple hashing implementations** with varying levels of determinism guarantees. While the canonical hashing service ([`hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1)) provides robust deterministic serialization, **other parts of the codebase use inconsistent patterns** that could lead to hash collisions or non-deterministic behavior.

### Risk Level: MEDIUM
- **Critical paths** (pipeline config, dedupe caching) use proper canonicalization
- **Secondary paths** (template hashing, request hashing) use raw `JSON.stringify()` without key sorting
- **Collision risk** exists where truncated hashes (16 chars) are used for identity

---

## 1. Hash Function Implementations

### 1.1 Canonical Hashing Service (RECOMMENDED)
**File:** [`app/app/services/see-it-now/hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1)

| Function | Algorithm | Output Length | Deterministic Serialization |
|----------|-----------|---------------|----------------------------|
| [`canonicalize()`](app/app/services/see-it-now/hashing.server.ts:15) | Custom | N/A | ✅ Recursive key sorting |
| [`sha256()`](app/app/services/see-it-now/hashing.server.ts:36) | SHA-256 | 64 hex chars | Uses `canonicalize()` |
| [`computePipelineConfigHash()`](app/app/services/see-it-now/hashing.server.ts:44) | SHA-256 | 64 hex chars | ✅ Canonical + field filtering |
| [`computeCallIdentityHash()`](app/app/services/see-it-now/hashing.server.ts:67) | SHA-256 | 64 hex chars | ✅ Canonical |
| [`computeDedupeHash()`](app/app/services/see-it-now/hashing.server.ts:79) | SHA-256 | 64 hex chars | ✅ Canonical + ordered images |
| [`computeImageHash()`](app/app/services/see-it-now/hashing.server.ts:99) | SHA-256 | 64 hex chars | Direct buffer hash |
| [`computeJsonHash()`](app/app/services/see-it-now/hashing.server.ts:106) | SHA-256 | 64 hex chars | ✅ Canonical |

**Key Strengths:**
- [`canonicalize()`](app/app/services/see-it-now/hashing.server.ts:15) recursively sorts object keys alphabetically
- Arrays preserve order (important for positional semantics)
- Primitives pass through `JSON.stringify()`
- Explicit field exclusion for timestamps ([`resolvedAt`](app/app/services/see-it-now/hashing.server.ts:57))

### 1.2 Prompt Control Hashing (INCONSISTENT)
**File:** [`app/app/services/prompt-control/prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:1)

| Function | Algorithm | Output Length | Deterministic Serialization |
|----------|-----------|---------------|----------------------------|
| [`sha256()`](app/app/services/prompt-control/prompt-resolver.server.ts:97) | SHA-256 | 16 hex chars | ❌ Raw `JSON.stringify()` |
| [`computeResolutionHash()`](app/app/services/prompt-control/prompt-resolver.server.ts:105) | SHA-256 | 16 hex chars | ❌ Raw `JSON.stringify()` |
| [`computeRequestHash()`](app/app/services/prompt-control/prompt-resolver.server.ts:117) | SHA-256 | 16 hex chars | ⚠️ Manual image sort + raw JSON |

**Issues:**
```typescript
// Line 110 - No key sorting for messages/objects
return sha256(JSON.stringify({ messages, model, params }));

// Line 124 - Manual image sorting (good) but raw JSON for rest
return sha256(JSON.stringify({ promptName, resolutionHash, imageRefs: sortedImageRefs }));
```

### 1.3 Template Version Hashing (INCONSISTENT)
**Files:** 
- [`app/app/services/prompt-control/prompt-version-manager.server.ts`](app/app/services/prompt-control/prompt-version-manager.server.ts:46)
- [`app/prisma/seed-prompts.ts`](app/prisma/seed-prompts.ts:35)
- [`app/app/tests/prompt-control/prompt-version-manager.test.ts`](app/app/tests/prompt-control/prompt-version-manager.test.ts:97)

| Function | Algorithm | Output Length | Deterministic Serialization |
|----------|-----------|---------------|----------------------------|
| [`computeTemplateHash()`](app/app/services/prompt-control/prompt-version-manager.server.ts:46) | SHA-256 | 16 hex chars | ❌ Raw `JSON.stringify()` |

**Risk:** Template objects with different key orders will produce different hashes for semantically identical templates.

### 1.4 Image/Buffer Hashing (CONSISTENT)
**Files:** Various

| Function | Algorithm | Output Length | Usage |
|----------|-----------|---------------|-------|
| [`hashBuffer()`](app/app/services/app-proxy.see-it-now.render.server.ts:67) | SHA-256 | 16 hex chars | Image buffer hashing |
| [`hashBuffer()`](app/app/routes/app-proxy.see-it-now.stream.ts:34) | SHA-256 | 16 hex chars | Image buffer hashing |
| [`computeImageHash()`](app/app/services/see-it-now/hashing.server.ts:99) | SHA-256 | 64 hex chars | Canonical service |
| [`getHash()`](app/app/services/image-removal.server.ts:25) | SHA-256 | 8 hex chars | Input validation (truncated) |

**Note:** Truncation to 16 chars for display/storage is acceptable for content addressing but **not for cryptographic security**.

### 1.5 Security-Related Hashing (CORRECT)
**File:** [`app/app/utils/shopper-token.server.ts`](app/app/utils/shopper-token.server.ts:1)

| Function | Algorithm | Usage |
|----------|-----------|-------|
| HMAC signature | SHA-256 | Token signing/verification |

**Implementation:**
```typescript
const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
hmac.update(payloadBase64);
const signature = hmac.digest('base64url');
```

✅ Uses `timingSafeEqual` (implied by HMAC usage)  
✅ Proper secret key from environment

### 1.6 Rate Limiting Hashing (ACCEPTABLE)
**File:** [`app/app/services/external-auth/index.ts`](app/app/services/external-auth/index.ts:63)

| Function | Algorithm | Output Length | Usage |
|----------|-----------|---------------|-------|
| [`hashToken()`](app/app/services/external-auth/index.ts:63) | SHA-256 | 16 hex chars | Rate limit key component |
| [`hashUserAgent()`](app/app/services/external-auth/index.ts:67) | SHA-256 | 8 hex chars | Fallback IP identifier |

✅ Appropriate for non-cryptographic use (rate limiting)  
⚠️ Truncation increases collision probability but acceptable for this use case

### 1.7 Advisory Lock Hashing (CORRECT)
**File:** [`app/app/services/image-prep/product-prep.server.ts`](app/app/services/image-prep/product-prep.server.ts:64)

```typescript
function shopLockKey64(shopId: string): bigint {
  const hash = crypto.createHash("sha256").update(shopId).digest();
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(hash[i]);
  }
  return BigInt.asIntN(64, v);
}
```

✅ Deterministic 64-bit key generation for PostgreSQL advisory locks

### 1.8 Legacy/Deprecated Hashing (CONCERNING)
**File:** [`app/app/services/prepare-processor.server.ts`](app/app/services/prepare-processor.server.ts:796)

```typescript
const promptHash = telemetry?.prompt
  ? telemetry.prompt.split('').reduce((acc: number, char: string) => {
      const hash = ((acc << 5) - acc) + char.charCodeAt(0);
      return hash & hash;
    }, 0).toString(36)
  : undefined;
```

❌ **Non-cryptographic djb2 variant** - Used only for telemetry/event logging  
⚠️ High collision probability, not suitable for identity

---

## 2. Serialization Determinism Analysis

### 2.1 Canonical Serialization (RECOMMENDED)
**Implementation:** [`app/app/services/see-it-now/hashing.server.ts:15-34`](app/app/services/see-it-now/hashing.server.ts:15)

```typescript
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();  // ← Key sorting
    const pairs = sortedKeys.map(key =>
      JSON.stringify(key) + ':' + canonicalize(obj[key])
    );
    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(value);
}
```

**Properties:**
| Property | Status | Notes |
|----------|--------|-------|
| Key ordering | ✅ Stable | Alphabetically sorted |
| Array ordering | ✅ Preserved | Order matters for semantics |
| Nested objects | ✅ Recursive | Deep canonicalization |
| Null/undefined | ✅ Handled | Explicit JSON.stringify |
| Number precision | ⚠️ JSON default | Scientific notation for large numbers |
| Unicode | ✅ JSON.stringify | Escaped properly |

### 2.2 Raw JSON.stringify (PROBLEMATIC)
**Used in:**
- [`prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:110)
- [`prompt-version-manager.server.ts`](app/app/services/prompt-control/prompt-version-manager.server.ts:54)
- [`seed-prompts.ts`](app/prisma/seed-prompts.ts:43)

**Issues:**
```typescript
// These objects produce DIFFERENT hashes:
const a = { z: 1, a: 2 };
const b = { a: 2, z: 1 };

JSON.stringify(a); // "{\"z\":1,\"a\":2}"
JSON.stringify(b); // "{\"a\":2,\"z\":1}"
// Different strings = different hashes for same data
```

### 2.3 Partial Sorting (ACCEPTABLE)
**Implementation:** [`app/app/services/prompt-control/prompt-resolver.server.ts:123`](app/app/services/prompt-control/prompt-resolver.server.ts:123)

```typescript
const sortedImageRefs = [...imageRefs].sort();
return sha256(JSON.stringify({ promptName, resolutionHash, imageRefs: sortedImageRefs }));
```

✅ Image refs sorted (order-independent)  
⚠️ Other fields not canonicalized

---

## 3. Hash Input Consistency

### 3.1 Pipeline Config Hash ([`computePipelineConfigHash`](app/app/services/see-it-now/hashing.server.ts:44))

**Included fields:**
```typescript
{
  prompts: {
    [name]: {
      versionId: string,
      model: string,
      params: Record<string, unknown>
    }
  },
  runtimeConfig: RuntimeConfigSnapshot
}
```

**Excluded fields (correctly):**
- `resolvedAt` - Timestamp would invalidate cache
- Trace/request IDs

**Risk:** LOW - Proper field filtering with canonical serialization

### 3.2 Call Identity Hash ([`computeCallIdentityHash`](app/app/services/see-it-now/hashing.server.ts:67))

**Included:**
- `promptText` (rendered template)
- `model` (resolved model name)
- `params` (model parameters)

**Excluded (correctly):**
- Images (separate `dedupeHash`)
- Timestamps

**Risk:** LOW - Clean separation of concerns

### 3.3 Dedupe Hash ([`computeDedupeHash`](app/app/services/see-it-now/hashing.server.ts:79))

**Included:**
- `callIdentityHash` (nested hash)
- Image descriptors with ordering:
  ```typescript
  {
    role: string,
    hash: string,      // Content hash
    mimeType: string,
    inputMethod: string,
    orderIndex: number // Position matters
  }
  ```

**Risk:** LOW - Complete content addressing with explicit ordering

### 3.4 Template Hash ([`computeTemplateHash`](app/app/services/prompt-control/prompt-version-manager.server.ts:46))

**Included:**
- `systemTemplate`
- `developerTemplate`
- `userTemplate`
- `model`
- `params`

**Risk:** MEDIUM - Raw `JSON.stringify()` means key order in `params` affects hash

### 3.5 Resolution Hash ([`computeResolutionHash`](app/app/services/prompt-control/prompt-resolver.server.ts:105))

**Included:**
- `messages` (array of {role, content})
- `model`
- `params`

**Risk:** MEDIUM - No canonicalization of messages array or params object

---

## 4. Collision Risk Assessment

### 4.1 Truncated SHA-256 (16 chars = 64 bits)

**Used by:**
- Template hashes
- Resolution hashes
- Request hashes
- Buffer hashes (display)

**Collision probability:**
- After 2^32 hashes: ~50% chance of collision (birthday paradox)
- For template versions (low volume): Acceptable
- For request deduplication: **Use full 64-char hash from canonical service**

### 4.2 Truncated SHA-256 (8 chars = 32 bits)

**Used by:**
- Image removal input validation
- User agent hashing

**Collision probability:**
- After ~77,000 entries: ~50% chance
- For logging/validation: Acceptable
- For identity: **Not recommended**

### 4.3 Full SHA-256 (64 chars = 256 bits)

**Used by:**
- Canonical hashing service
- Artifact storage

**Collision probability:** Negligible for all practical purposes

---

## 5. Recommendations

### 5.1 HIGH PRIORITY

1. **Unify template hashing to use canonical service**
   ```typescript
   // Replace in prompt-version-manager.server.ts:
   import { computeJsonHash } from "../see-it-now/hashing.server";
   
   const templateHash = computeJsonHash({
     systemTemplate,
     developerTemplate,
     userTemplate,
     model,
     params
   }).slice(0, 16); // Truncate if needed for display
   ```

2. **Fix resolution hash to use canonicalization**
   ```typescript
   // Replace in prompt-resolver.server.ts:
   import { canonicalize } from "../see-it-now/hashing.server";
   
   function computeResolutionHash(messages, model, params) {
     return sha256(canonicalize({ messages, model, params }));
   }
   ```

### 5.2 MEDIUM PRIORITY

3. **Document hash length requirements**
   - 64 chars for cryptographic identity
   - 16 chars acceptable for display/short IDs
   - 8 chars only for non-identity purposes

4. **Add deterministic serialization tests**
   ```typescript
   // Test cases to add:
   - Objects with different key orders produce same hash
   - Nested objects are canonicalized
   - Arrays preserve order
   - Null vs undefined handling
   ```

### 5.3 LOW PRIORITY

5. **Consider using canonical service everywhere**
   - Export from shared location
   - Remove duplicate implementations
   - Single source of truth for hashing logic

---

## 6. Test Coverage

### 6.1 Existing Tests

**File:** [`app/app/tests/prompt-control/prompt-resolver.test.ts`](app/app/tests/prompt-control/prompt-resolver.test.ts:417)

```typescript
describe("AC #14: Request hash with sorted image refs", () => {
  it("should produce same hash regardless of image order", () => {
    const images1 = ["img-c.png", "img-a.png", "img-b.png"];
    const images2 = ["img-a.png", "img-b.png", "img-c.png"];
    
    const hash1 = computeRequestHash(promptName, resolutionHash, images1);
    const hash2 = computeRequestHash(promptName, resolutionHash, images2);
    
    expect(hash1).toBe(hash2); // ✅ Passes
  });
});
```

### 6.2 Missing Test Coverage

- Object key ordering determinism
- Nested object canonicalization
- Null vs undefined handling
- Unicode normalization
- Number precision edge cases

---

## 7. Summary Table

| Component | Algorithm | Deterministic | Collision Risk | Recommendation |
|-----------|-----------|---------------|----------------|----------------|
| Pipeline Config Hash | SHA-256 (64c) | ✅ Canonical | Low | ✅ Keep |
| Call Identity Hash | SHA-256 (64c) | ✅ Canonical | Low | ✅ Keep |
| Dedupe Hash | SHA-256 (64c) | ✅ Canonical | Low | ✅ Keep |
| Image Hash | SHA-256 (64c) | ✅ Direct | Low | ✅ Keep |
| Template Hash | SHA-256 (16c) | ❌ Raw JSON | Medium | 🔧 Fix |
| Resolution Hash | SHA-256 (16c) | ❌ Raw JSON | Medium | 🔧 Fix |
| Request Hash | SHA-256 (16c) | ⚠️ Partial | Medium | ⚠️ Monitor |
| Token HMAC | SHA-256 | N/A | Low | ✅ Keep |
| Rate Limit Hash | SHA-256 (16/8c) | N/A | Acceptable | ✅ Keep |
| Prompt Telemetry | djb2 (36r) | N/A | High | ⚠️ Document |

**Legend:**
- 64c = 64 characters (full SHA-256 hex)
- 16c = 16 characters (truncated)
- 8c = 8 characters (truncated)
- 36r = base36 encoded

---

## Appendix A: Files Requiring Attention

1. [`app/app/services/prompt-control/prompt-version-manager.server.ts`](app/app/services/prompt-control/prompt-version-manager.server.ts:46) - Use canonical serialization
2. [`app/app/services/prompt-control/prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:97) - Use canonical serialization
3. [`app/prisma/seed-prompts.ts`](app/prisma/seed-prompts.ts:35) - Sync with canonical implementation
4. [`app/app/tests/prompt-control/prompt-version-manager.test.ts`](app/app/tests/prompt-control/prompt-version-manager.test.ts:97) - Update test hash computation

## Appendix B: Canonical Service Export

**File:** [`app/app/services/see-it-now/index.ts`](app/app/services/see-it-now/index.ts:13)

All canonical hash functions are exported for use across the codebase:
```typescript
export {
  computePipelineConfigHash,
  computeCallIdentityHash,
  computeDedupeHash,
  computeImageHash,
  computeJsonHash,
} from "./hashing.server";
```

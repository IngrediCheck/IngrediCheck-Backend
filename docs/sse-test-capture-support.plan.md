# Add SSE Endpoint Support for Test Case Capture and Replay

## Overview

Enable the test framework to capture and replay SSE responses from `/ingredicheck/analyze-stream`. SSE responses will be stored as a single request with an array of events, and replay will enforce strict event ordering.

## Implementation Steps

### 1. Update Type Definitions

**File: `supabase/functions/ingredicheck/index.ts`**

Extend the `CapturedBody` union so the recording middleware can persist SSE payloads:

```typescript
type CapturedBody =
  | { type: 'json'; payload: unknown }
  | { type: 'form-data'; payload: { fields: Record<string, unknown>; files: Array<Record<string, unknown>> } }
  | { type: 'text'; payload: string }
  | { type: 'bytes'; payload: string }
  | { type: 'empty'; payload: null }
  | { type: 'sse'; payload: Array<{ event: string; data: unknown }> };  // NEW
```

**File: `supabase/tests/capture-testcase.ts`**

Augment the `RecordingArtifact` response to record the transport used during capture:

```typescript
response: {
  status: number;
  bodyType: 'json' | 'text' | 'bytes' | 'empty' | 'sse';
  body: unknown;
};
```

This makes response types explicit for both legacy JSON captures and the new SSE shape. The same discriminated union should mirror in `supabase/tests/run-testcase.ts` within the `RecordedRequest` definition so replay logic has the type information.

### 2. Capture SSE Responses in Recording Middleware

**File: `supabase/functions/ingredicheck/index.ts`**

Modify the recording middleware (lines 134-180) to detect and capture SSE streams:

- After `await next()` completes, check the response `Content-Type` header for `text/event-stream` and ensure `ctx.response.body` is a `ReadableStream`.
- Use `ReadableStream.tee()` so the client keeps receiving the SSE stream while the middleware reads the duplicate stream to parse events.
- Parse events according to the SSE framing (`event: <name>\n`, optional `data: <payload>\n`, blank line terminator). If multiple `data:` lines occur, join them with `\n` before decoding.
- JSON-decode event payloads when possible; fall back to raw strings on parse errors so capture never crashes.
- Await completion of the capture reader before inserting into `recorded_sessions`; the middleware currently inserts immediately after `serializeResponseBody`, so move the insert inside the SSE branch once events are available.
- Persist SSE captures as `{ type: 'sse', payload: events }` via the `CapturedBody` container so downstream artifacts stay consistent with other body types.

### 3. Serialize SSE Response in Recording

**File: `supabase/functions/ingredicheck/index.ts`**

Update `serializeResponseBody()` so it no longer runs on SSE responses. Instead:

- Keep the existing serializer for non-stream bodies.
- When SSE is detected, bypass `serializeResponseBody()` and reuse the parsed `events` array from step 2 so JSON serialization remains predictable.

### 4. Apply Variable Placeholders to SSE Events

**File: `supabase/tests/capture-testcase.ts`**

Extend `injectVariablePlaceholders()` so it understands the new `bodyType` discriminator:

- When `response.bodyType === 'sse'`, traverse `response.body` (the captured events array), applying `collectIds()` and `applyPlaceholders()` to each event object and its nested data.
- Preserve existing placeholder logic for every other body type.

### 5. Replay SSE Responses

**File: `supabase/tests/run-testcase.ts`**

Modify `replayRequest()` function (lines 1094-1161) to handle SSE responses:

- Use the recorded `entry.response.bodyType` to determine how to read the response instead of relying solely on headers.
- For `'sse'`, skip the existing `response.text()` path entirely; the first read must consume the original stream.
- Parse incoming SSE events into an array using a shared helper (see step 6).
- Compare the parsed events against the recorded array with strict ordering, leveraging `compareBodies()` for the `data` payload inside each event.

### 6. Add SSE Stream Parser Utility

**File: `supabase/tests/run-testcase.ts`**

Add `parseSSEStream()` to parse responses and mirror the middleware’s parser:

```typescript
async function parseSSEStream(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: unknown }>> {
  const events: Array<{ event: string; data: unknown }> = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = extractEventsFromBuffer(buffer, events);
  }

  buffer += decoder.decode(); // flush
  extractEventsFromBuffer(buffer, events);
  return events;
}
```

`extractEventsFromBuffer` can be a small helper that identifies complete SSE frames, keeping the parser symmetric with capture logic.

### 7. Add SSE Event Comparison Function

**File: `supabase/tests/run-testcase.ts`**

Add `compareSSEEvents()` to validate the streamed events:

```typescript
function compareSSEEvents(
  expected: Array<{ event: string; data: unknown }>,
  actual: Array<{ event: string; data: unknown }>,
  variables: PlaceholderStore,
  errors: string[],
  warnings: string[],
  replacements?: ReplacementStore,
) {
  if (!Array.isArray(expected)) {
    errors.push("Expected SSE response to be an array of events");
    return;
  }
  if (expected.length !== actual.length) {
    errors.push(`SSE event count mismatch (expected ${expected.length}, received ${actual.length})`);
    return;
  }
  expected.forEach((expectedEvent, index) => {
    const actualEvent = actual[index];
    if (expectedEvent.event !== actualEvent.event) {
      errors.push(`SSE event[${index}]: expected "${expectedEvent.event}" but received "${actualEvent.event}"`);
      return;
    }
    compareBodies(
      expectedEvent.data,
      actualEvent.data,
      variables,
      `$.response.body[${index}].data`,
      errors,
      warnings,
      replacements,
    );
  });
}
```

### 8. Confirm Request Builders Need No Changes

SSE applies only to responses, so `buildRequestBody()` remains unchanged. Document this explicitly to avoid introducing unused request body types.

### 9. Testing

After implementation:

- Manually test capturing a test case that uses `/ingredicheck/analyze-stream`
- Verify the JSON artifact contains SSE events properly
- Run replay to ensure SSE events are parsed and compared correctly
- Confirm existing test cases still work (backward compatibility)

## Files Modified

1. `supabase/functions/ingredicheck/index.ts` - Recording middleware for SSE capture
2. `supabase/tests/capture-testcase.ts` - Type definitions and placeholder handling
3. `supabase/tests/run-testcase.ts` - SSE replay and comparison logic

## Key Design Decisions

- Store SSE as single request with array of events (not multiple request entries)
- Enforce strict event ordering during comparison
- Maintain backward compatibility with existing non-SSE test cases
- Reuse existing `compareBodies()` function for event data comparison

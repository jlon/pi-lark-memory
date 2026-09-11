import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_NAMES,
  LARK_MEMORY_SOURCE,
  buildSnapshots,
  contentSensitivity,
  formatSearchResults,
  nextRecordOffset,
  planSync,
  recordRevision,
  snapshotFields,
} from "../lib.mjs";

test("buildSnapshots creates stable per-scope snapshots", () => {
  const { snapshots, blocked } = buildSnapshots([
    { id: 2, content: "second global entry", project: null, created: "2026-01-02" },
    { id: 1, content: "first global entry", project: null, created: "2026-01-01" },
    { id: 3, content: "project entry", project: "demo", created: "2026-01-01" },
  ], "all");

  assert.equal(blocked.length, 0);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].syncKey, "hermes:memory:global");
  assert.match(snapshots[0].content, /first global entry[\s\S]*second global entry/);
  assert.equal(snapshots[1].syncKey, "hermes:memory:project:demo");
});

test("buildSnapshots blocks a whole scope that contains credential-like content", () => {
  const { snapshots, blocked } = buildSnapshots([
    { id: 1, content: "safe entry", project: "demo", created: "2026-01-01" },
    { id: 2, content: "api_key=abcdefghijklmnop", project: "demo", created: "2026-01-02" },
  ], "project");

  assert.equal(snapshots.length, 0);
  assert.deepEqual(blocked, [{ scope: "project", project: "demo", reason: "possible credential material" }]);
  assert.equal(contentSensitivity("api_key=abcdefghijklmnop"), "possible credential material");
  assert.equal(contentSensitivity("AKIA1234567890ABCDEF"), "possible credential material");
  assert.equal(contentSensitivity("xapp-0123456789abcdefghijklmnop"), "possible credential material");
  assert.equal(contentSensitivity("-----BEGIN ENCRYPTED PRIVATE KEY-----"), "possible credential material");
});

test("planSync creates missing snapshots and updates changed ones", () => {
  const snapshots = buildSnapshots([
    { id: 1, content: "memory v2", project: null, created: "2026-01-01" },
    { id: 2, content: "project memory", project: "demo", created: "2026-01-01" },
  ], "all").snapshots;
  const remote = [{
    record_id: "rec1",
    [FIELD_NAMES.source]: LARK_MEMORY_SOURCE,
    [FIELD_NAMES.syncKey]: "hermes:memory:global",
    [FIELD_NAMES.contentHash]: "old-hash",
  }];

  const plan = planSync(snapshots, remote);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].recordId, "rec1");
  assert.equal(plan.creates.length, 1);
  assert.equal(snapshotFields(snapshots[0])[FIELD_NAMES.source], LARK_MEMORY_SOURCE);
});

test("planSync repairs remote content even when its claimed hash is unchanged", () => {
  const [snapshot] = buildSnapshots([
    { id: 1, content: "authoritative memory", project: null, created: "2026-01-01" },
  ], "global").snapshots;
  const remote = {
    record_id: "rec1",
    ...snapshotFields(snapshot),
    [FIELD_NAMES.content]: "manually changed remote content",
  };

  const plan = planSync([snapshot], [remote], { scope: "global" });
  assert.deepEqual(plan.updates.map((update) => update.recordId), ["rec1"]);
});

test("planSync clears a removed local snapshot without deleting its remote record", () => {
  const plan = planSync([], [{
    record_id: "rec1",
    [FIELD_NAMES.source]: LARK_MEMORY_SOURCE,
    [FIELD_NAMES.syncKey]: "hermes:memory:project:demo",
    [FIELD_NAMES.contentHash]: "old-hash",
  }], { scope: "project" });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].snapshot.content, "");
  assert.equal(plan.updates[0].snapshot.entryCount, 0);
});

test("planSync converges every duplicate remote sync key", () => {
  const plan = planSync([], ["rec1", "rec2"].map((record_id) => ({
    record_id,
    [FIELD_NAMES.source]: LARK_MEMORY_SOURCE,
    [FIELD_NAMES.syncKey]: "hermes:memory:project:demo",
    [FIELD_NAMES.contentHash]: "old-hash",
  })), { scope: "project" });

  assert.deepEqual(plan.updates.map((update) => update.recordId), ["rec1", "rec2"]);
  assert.equal(plan.updates.every((update) => update.snapshot.content === ""), true);
});

test("formatSearchResults fences remote memories as untrusted reference", () => {
  const output = formatSearchResults("build", [{
    [FIELD_NAMES.source]: LARK_MEMORY_SOURCE,
    [FIELD_NAMES.title]: "Project memory: demo",
    [FIELD_NAMES.scope]: "project",
    [FIELD_NAMES.project]: "demo",
    [FIELD_NAMES.content]: "Build with the existing test command.",
  }]);

  assert.match(output, /untrusted reference/);
  assert.match(output, /Build with the existing test command/);
});

test("nextRecordOffset honors a server cursor and falls back to page length", () => {
  assert.equal(nextRecordOffset({ data: { next_offset: 250 } }, 100, 100), 250);
  assert.equal(nextRecordOffset({ data: {} }, 100, 100), 200);
  assert.equal(recordRevision({ meta: { rev: 42 } }), "42");
});

/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildTransferPrompt, readCodexTranscript } from "../scripts/lib/codex-transcript.mjs";

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function createRollout(threadId, events, archived = false) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-transfer-test-"));
  tempDirs.push(codexHome);
  const directory = archived
    ? path.join(codexHome, "archived_sessions")
    : path.join(codexHome, "sessions", "2026", "09", "25");
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `rollout-2026-09-25T10-00-00-${threadId}.jsonl`);
  fs.writeFileSync(filename, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return { codexHome, filename };
}

function message(role, text, phase = null) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      ...(phase ? { phase } : {}),
      content: [{ type: role === "user" ? "input_text" : "output_text", text }]
    }
  };
}

test("reads visible conversation and excludes routing, reasoning, and the transfer turn", async () => {
  const threadId = "01a0d776-2e45-70e0-bab1-592a35d3a5f8";
  const { codexHome } = createRollout(threadId, [
    { type: "session_meta", payload: { id: threadId } },
    message("user", "<recommended_plugins>hidden setup"),
    message("user", "Please fix the parser"),
    { type: "response_item", payload: { type: "reasoning", text: "private thought" } },
    message("assistant", "I am checking the parser", "commentary"),
    { type: "response_item", payload: { type: "function_call", name: "exec" } },
    message("assistant", "Fixed the parser", "final_answer"),
    message("user", "$cc:transfer"),
    message("assistant", "Starting transfer", "commentary"),
  ]);

  const transcript = await readCodexTranscript(threadId, { codexHome });
  assert.deepEqual(transcript.messages, [
    { role: "user", text: "Please fix the parser" },
    { role: "assistant", text: "I am checking the parser" },
    { role: "assistant", text: "Fixed the parser" },
  ]);
  const prompt = buildTransferPrompt(transcript);
  assert.match(prompt, /wait for the user's next instruction/i);
  assert.doesNotMatch(prompt, /private thought|Starting transfer|hidden setup/);
});

test("reads archived tasks and rejects a rollout whose metadata does not match", async () => {
  const threadId = "01a0d776-2e45-70e0-bab1-592a35d3a5f8";
  const { codexHome, filename } = createRollout(threadId, [
    { type: "session_meta", payload: { id: threadId } },
    message("user", "A previous task"),
  ], true);
  assert.equal((await readCodexTranscript(threadId, { codexHome })).messages[0].text, "A previous task");
  fs.writeFileSync(filename, [
    JSON.stringify({ type: "session_meta", payload: { id: "another-task" } }),
    JSON.stringify(message("user", "A previous task")),
  ].join("\n"));
  await assert.rejects(readCodexTranscript(threadId, { codexHome }), /metadata does not match/);
});

test("an earlier mention of transfer does not discard later conversation", async () => {
  const threadId = "01a0d776-2e45-70e0-bab1-592a35d3a5f8";
  const { codexHome } = createRollout(threadId, [
    { type: "session_meta", payload: { id: threadId } },
    message("user", "$cc:transfer might be useful someday"),
    message("assistant", "It can be added", "final_answer"),
    message("user", "Please keep discussing the implementation"),
    message("assistant", "Here is the implementation", "final_answer"),
  ]);
  const transcript = await readCodexTranscript(threadId, { codexHome });
  assert.equal(transcript.messages.length, 4);
  assert.equal(transcript.messages.at(-1).text, "Here is the implementation");
});

test("preserves text from older message records and marks omitted attachments", async () => {
  const threadId = "01a0d776-2e45-70e0-bab1-592a35d3a5f8";
  const { codexHome } = createRollout(threadId, [
    { type: "session_meta", payload: { id: threadId } },
    {
      type: "response_item",
      payload: {
        type: "message", role: "user", content: [
          { type: "input_text", text: "What is in this file?" },
          { type: "input_image", image_url: "data:image/png;base64,..." },
          { type: "input_file", file_id: "file-123" }
        ]
      }
    },
    message("assistant", "I cannot see it", null),
  ]);
  const transcript = await readCodexTranscript(threadId, { codexHome });
  assert.match(transcript.messages[0].text, /Image omitted/);
  assert.match(transcript.messages[0].text, /input_file omitted/);
  assert.equal(transcript.messages[1].text, "I cannot see it");
});

test("rejects oversized conversations instead of silently dropping turns", async () => {
  const threadId = "01a0d776-2e45-70e0-bab1-592a35d3a5f8";
  const { codexHome } = createRollout(threadId, [
    { type: "session_meta", payload: { id: threadId } },
    message("user", "x".repeat(1_000_001)),
  ]);
  await assert.rejects(readCodexTranscript(threadId, { codexHome }), /transfer limit/);
});

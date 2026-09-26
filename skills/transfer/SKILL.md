---
name: transfer
description: 'Transfer the current Codex task conversation into a new, resumable Claude Code session. Args: --model <model>, --effort <low|medium|high|xhigh|max>. Use when the user wants to continue this conversation in Claude Code.'
---

# Claude Code Transfer

Use this skill when the user asks to move the current Codex task conversation to Claude Code. The companion reads the local Codex transcript, sends visible text turns as context, and starts a new resumable Claude session. The import turn only acknowledges the handoff; the user gives Claude its next instruction after resuming.

Resolve `<plugin-root>` as two directories above this `SKILL.md` file. Run this command as one blocking foreground shell call:
`node "<plugin-root>/scripts/claude-companion.mjs" transfer $ARGUMENTS`

The companion starts Claude in the Codex task's recorded working directory, so `claude --resume` from that directory lists the new session. Do not pass `--cwd` unless the user asks for a different directory.

Supported arguments: `--model <model>`, `--effort <low|medium|high|xhigh|max>`. Forward an explicit `--model` value unchanged to the companion. Claude Code owns model aliases and effort support; `/model` shows the options for the current account.

The command identifies the current Codex task from the session environment. Do not summarize the conversation, copy session files, or call `claude` directly. If the current task cannot be identified, ask the user for its task ID and retry with `--thread-id <Codex-task-id>`.

The handoff sends conversation text to Claude Code. Images, audio, tool traffic, hidden instructions, and reasoning are not transferred. Do not claim those items moved. If the companion fails, report its error without claiming a Claude session was created.

When using `exec_command`, pass `sandbox_permissions: "require_escalated"` and the justification `Allow the Claude Code companion to contact the Claude API for this requested transfer.` for this command; the default sandbox cannot reach the Claude API. Wait for command exit. Present its returned Claude session ID, the directory it started in, and the `claude --resume <session-id>` command to run from that directory.

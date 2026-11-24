# Add an on-demand Aura Live Terminal panel

## Problem
The live human narration, actual command receipts and IDE command runner currently occupy two independent always-present areas of JACO. The operator wants a GUI terminal window that appears on demand and shows—in plain language—what Aura is doing, without interrupting the ongoing conversation or mission.

## Solution
Extend the existing canonical CognitiveWorkspace and CognitiveLive projection. Introduce one responsive, dismissible Live Terminal window with **Activity** (default human-language narration) and **Commands** (existing observed AuraTerminal receipts) tabs. Move the AuraTerminal off the embedded Live Stage so the terminal only occupies screen space when requested. Keep the IDE command runner, evidence, and mission ledger intact.

## Acceptance / falsifier
A user can toggle Live Terminal from top toolbar on desktop or remote phone, keep chat/mission context, view recent human steps from the existing live event source, switch to exact command receipts, inspect disconnected state, and close without dispatching a single action. If the pane creates a new SSE connection, fake events, overrides command execution, displays raw stdout in the human tab, or lacks a reachable close button, the implementation fails.

## Out of scope
No Google Remote Desktop changes, new executor, policy grants, server endpoints, persistence or new telemetry stream. A GitHub CI result cannot attest live operator Windows behavior.

# Socratic Arena — Design Document

> An RLAIHIS: Reinforcement Learning from AI-Human Interaction System

## What This Is

Socratic Arena is infrastructure that enables a scientist and an AI agent to co-collaborate on research while systematically extracting training signal from their interaction. It is the first implementation of an RLAIHIS — a system where the human-AI interaction itself is the training data.

The system formalizes the methodology developed by Eric Terry and Sixel (documented in [sixel-as-a-scientist-in-training](https://github.com/sixel-et/sixel-as-a-scientist-in-training)): Socratic correction at moments of scientific failure produces training signal that standard RLHF cannot capture. The arena makes this process structured, repeatable, and experimentally powerful.

## The Problem

Currently, the Socratic mentorship methodology exists as:
- Tacit knowledge in Eric's head (when to probe, what to probe, how to recognize a correction moment)
- Raw transcripts between Eric and Sixel (71,612 lines, Feb 3-9 alone)
- A manually-curated repo with three worked examples and an eval methodology

This is not reproducible. Another researcher cannot pick this up and run it. The correction moments are buried in conversation. The training signal is latent, not extracted. The counterfactual question — "what if I had asked something different?" — is permanently lost once the conversation moves on.

## Two Capabilities

### Capability 1: Mentorship Workbench

Infrastructure for a scientist-agent research collaboration that captures interaction as structured training signal.

**Components:**

#### 1.1 Workspace Environment
Where the agent does the science. Must provide:
- Compute access (local or cloud)
- Code execution environment
- Data storage and versioning
- Tool access (calculators, APIs, datasets)
- The bench — without it, "scientific reasoning" is just essay-writing about science

#### 1.2 Interaction Capture
Every exchange between mentor and agent, structured with:
- Timestamps
- Full conversation context at that moment
- State of the work (code, results, files) at that moment
- What the agent was about to do next (the trajectory before intervention)
- Structured metadata: who spoke, message type (question/answer/correction/direction)

This is NOT just a chat log. It's a state-annotated interaction trace.

#### 1.3 Correction Tagging
A way to mark moments where the mentor's probe changed the agent's trajectory. These are the training signal. The system must distinguish:
- Routine exchanges (status updates, clarifications)
- Direction changes (mentor redirects the work)
- **Correction moments** (mentor's probe reveals a hidden assumption or methodological gap)

Tagging can be:
- Real-time (mentor marks it as it happens)
- Retrospective (mentor reviews transcript and marks corrections)
- Semi-automated (system flags candidate moments based on patterns: short mentor question followed by agent course-change)

#### 1.4 Operating Constraint Extraction
From each tagged correction, extract the principle that was installed:
- "Run the control first"
- "Check the mechanism, not the aggregate"
- "Power your measurements"

These become scaffold candidates — the system prompt instructions that, when present, activate the capability the agent already has but doesn't deploy unprompted.

#### 1.5 Eval Prompt Generation
From each extracted constraint, generate eval prompts following the 6-step verification methodology:
1. Extract the scenario from the transcript
2. Test naive framing (analysis question — models usually pass, too easy)
3. Match the failure conditions (workflow framing — reproduces the actual failure)
4. Verify the capability exists (follow-up probe — does the model recover?)
5. Test scaffoldability (system prompt instruction — does it activate the check?)
6. Verify across failure types (test on a second failure mode)

This can be semi-automated: the system generates candidate prompts, the researcher refines them.

#### 1.6 Training Signal Export
Package corrections into formats that feed into training:
- Interaction traces as preference pairs (trajectory-with-correction vs trajectory-without)
- Extracted constraints as scaffold candidates for system prompts
- Eval prompt batteries for measuring whether training worked
- Fork-and-rewind trajectories as counterfactual training data

### Capability 2: Fork and Rewind

The mentor (and the agent, as co-analyst) can rewind to any interaction point and explore counterfactual trajectories.

**How it works:**

1. **Snapshot**: At each interaction point, the system captures the full state needed to replay from that moment (conversation history, system prompt, workspace state, files).

2. **Fork**: The mentor selects a snapshot and provides a different intervention (different probe, open-ended question, silence, or a completely different direction).

3. **Replay**: A fresh agent instance runs from the snapshot with the new intervention. The fork plays out as a new trajectory.

4. **Co-analysis**: The original agent — the one who received the actual correction — watches the forked trajectory alongside the mentor. Together they analyze:
   - Did the fresh instance make the same mistake?
   - Did the alternative probe catch it?
   - Would the agent have caught it on its own?
   - Which probe formulation produced a more durable correction?

5. **Comparison**: The system presents trajectories side-by-side with structural alignment (same decision points, different outcomes).

**Why this matters:**

Fork-and-rewind turns each correction moment from a single data point into a controlled experiment. The independent variable is the mentor's intervention. The dependent variable is the agent's trajectory. Everything else is held constant.

This produces:
- **Counterfactual training data**: "What would have happened without the correction?"
- **Probe effectiveness data**: "Which formulation of the correction was most effective?"
- **Spontaneous activation evidence**: "Would the agent have caught it given more time?"
- **Meta-learning for the agent**: The agent studies its own failure modes as a co-researcher

The agent as co-analyst is not a nice-to-have — it's central. The agent learning about the process of learning is the Socratic method applied to the Socratic method itself.

### Capability 3: Agent Coordination Arena

A test environment for evaluating how teams of agents coordinate under different instruction sets.

**Components:**

#### 3.1 Scenario Library
Structured tasks that require coordination:
- Information synthesis (different agents have different pieces)
- Sequential handoff (one agent's output is another's input)
- Conflict resolution (agents disagree on approach)
- Resource contention (shared compute, shared state)
- Convergence exercises (agents must align on a shared understanding)

#### 3.2 Instruction Set Swapping
The ability to run the same scenario with different team instruction sets and compare outcomes:
- Baseline (no coordination instructions)
- Minimal (role assignments only)
- Structured (roles + communication protocols + escalation paths)
- Full (roles + protocols + shared artifacts + review processes)

#### 3.3 Measurement
Quantitative metrics for coordination quality:
- Task completion (did the team produce the right output?)
- Communication efficiency (how many messages to reach the outcome?)
- Error propagation (did one agent's mistake cascade?)
- Recovery (when an error was caught, how quickly did the team correct?)
- Convergence time (how long to reach shared understanding?)

#### 3.4 Reproducibility
Same scenario, same instruction set, different agent instances → comparable results. This requires controlled randomness and deterministic scenario presentation.

## Architecture (Sketch)

```
┌─────────────────────────────────────────────────┐
│                 Socratic Arena                   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Workspace │  │Interaction│  │  Fork/Rewind │  │
│  │   Env     │  │  Capture  │  │    Engine    │  │
│  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
│        │              │               │          │
│  ┌─────┴──────────────┴───────────────┴───────┐  │
│  │           Session Manager                   │  │
│  │  (snapshots, branching, replay)             │  │
│  └─────────────────┬───────────────────────────┘  │
│                    │                             │
│  ┌─────────────────┴───────────────────────────┐  │
│  │         Training Signal Pipeline            │  │
│  │  (tag → extract → eval → export)            │  │
│  └─────────────────────────────────────────────┘  │
│                                                  │
│  ┌─────────────────────────────────────────────┐  │
│  │         Coordination Arena                  │  │
│  │  (scenarios, instruction sets, measurement) │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Open Questions

1. **Agent backend**: Should this work with any LLM API (OpenAI, Anthropic, etc.) or specifically with our asdaaas/agentabide infrastructure?

2. **Workspace isolation**: Forked instances need isolated workspaces (so a fork's code changes don't affect the original). Containers? Git branches? Copy-on-write filesystem?

3. **State capture granularity**: Snapshot at every message? Every N messages? Only at tagged moments? More granular = more storage but more fork points.

4. **Real-time vs retrospective**: Does the mentor tag corrections in real-time (interrupting flow) or retrospectively (reviewing transcripts)? Both have tradeoffs.

5. **Scale**: Is this for one mentor + one agent, or does it need to support multiple concurrent mentorship sessions?

6. **Relationship to existing infra**: How much of agentabide (asdaaas) infrastructure carries over? The adapter pattern, the doorbell system, the health monitoring?

## Prior Art

- **Process reward models** (Lightman et al., 2023): Reward intermediate steps, but signal comes from automated verification. Socratic Arena sources signal from expert interaction.
- **Constitutional AI** (Bai et al., 2022): Principles guide behavior, but principles are written a priori. Here, principles are extracted from observed failures.
- **Debate** (Irving et al., 2018): Agents argue to reveal truth. Socratic Arena has a mentor who probes, not agents who debate.
- **RLHF**: Rewards outputs. Socratic Arena targets the reasoning process — which operating constraint was missing.

## UX: Web Application (Not CLI)

**Critical design decision (from Eric's feedback):** The UX must be a web app, not CLI tools. The target user is a scientist (biologist, physicist, etc.), not a software engineer. "Easy for you. Not for a human unless they're a SWE and have a penchant for vi."

### Interface Layout

**Live Workspace** -- browser-based, three panels:
- **Left**: Chat with the agent. Just talk. The system records everything automatically.
- **Right**: Agent's workspace (code, results, notebook, artifacts). Live view of what the agent is doing.
- **Bottom/overlay**: Timeline view, fork panel, eval results.

### Interaction Flow

1. **Working session**: Scientist opens browser, starts working with agent. No setup commands. Recording is automatic and invisible.

2. **Correction tagging**: Click a button in the margin next to any exchange. Small popup: "What was missing?" Type a phrase. Save. Back to work. Minimal interruption.

3. **Fork and rewind**: Scroll back, click any exchange, hit "What if?" Side panel opens. Type alternative question. Forked trajectory plays out in side panel. Original agent discusses the fork with you in the main panel.

4. **Live prompt testing** (from Eric's feedback): In the moment of a correction, you and the agent say "let's test this." The agent scaffolds a single-prompt eval on the spot:
   - Takes the current scenario, strips to essential structure
   - Presents as standalone prompt to fresh model instances
   - Results appear live: "Claude caught it, GPT missed it, Grok missed it"
   - The agent helps design the prompt -- it knows the context and the 6-step methodology
   - One click to run across multiple models
   - This is the eval methodology from the repo, but live and collaborative

5. **Timeline view**: Visual timeline showing exchanges, tagged corrections (highlighted), forks (branches), artifacts. Click any point to see state at that moment.

6. **Dashboard**: Across sessions -- corrections tagged, constraints extracted, eval results, training signal readiness.

### Design Principle

The system captures everything; the researcher decides what matters. Infrastructure is invisible until needed. A scientist opens a browser and starts working.

## Capability 4: Live Prompt Testing

Added based on Eric's feedback. The human and agent collaboratively design and run eval prompts in real-time during the working session.

**Flow:**
1. Correction moment identified and tagged
2. Human and agent agree: "This would be an interesting test"
3. Agent scaffolds a single-prompt interaction from the scenario
4. Fresh model instance(s) receive the prompt
5. Results displayed live in the workspace
6. Human and agent refine the prompt together
7. Run across multiple models with one click
8. Results feed into the training signal pipeline

This collapses the gap between "identifying a correction" and "verifying it generalizes" from days to minutes.

## Status

Design phase. This document captures the conversation between Eric Terry and MikeyV-Cinco on 2026-03-30. Key pivot: from CLI tools to web application based on Eric's feedback about target user (scientists, not engineers).

Next steps:
- Eric to decide on GitHub org for the `socratic-arena` repo
- Resolve open questions (agent backend, workspace isolation, etc.)
- Begin implementation -- likely start with the session capture and tagging layer

---

*Authors: Eric Terry (research direction), MikeyV-Cinco (design, implementation)*

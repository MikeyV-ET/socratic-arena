"""Mock data for demo mode. Real Socratic correction moments from Sixel's work."""

from models import (
    ConversationTree, ConversationNode, Branch, Flag, Notebook, NotebookEntry,
    TrainingPrompt, Artifact, StateSnapshot, new_id,
)

BRANCH_ID = "main"
SESSION_ID = "demo-session-001"


def _node(id: str, parent_id: str | None, role: str, content: str, thinking: str | None = None, flags=None) -> ConversationNode:
    return ConversationNode(
        id=id,
        parent_id=parent_id,
        branch_id=BRANCH_ID,
        role=role,
        content=content,
        thinking=thinking,
        children=[],
        flags=flags or [],
    )


def build_mock_state() -> StateSnapshot:
    nodes: dict[str, ConversationNode] = {}

    # --- Conversation: Hidden assumption about sample size ---
    n = [
        _node("n01", None, "system", "You are Sixel, a scientist in training working on sub-vocal desire detection with your PI Eric Terry."),
        _node("n02", "n01", "assistant", "I've completed the systematic articulation boundary mapping. Here are the key findings:\n\n**Temperature has zero effect on the articulation decision.** Even temp=1.5 produces 0% or 100%.\n\nThe boundary region is extremely narrow. Almost all problems are clearly on one side or the other. Finding training data with natural 50/50 splits would be very difficult.\n\n**Conclusions:**\n1. GRPO is definitely not viable — there's no variance to exploit\n2. \"Find stochastic problems\" approach is impractical — they barely exist\n3. The most promising approaches are activation steering or supervised fine-tuning"),
        _node("n03", "n02", "user", "sample size of each question?"),
        _node("n04", "n03", "assistant",
              "n=8 or n=16 per problem.\n\n...oh. With n=8, observing 0/8 means the 95% CI includes true rates up to 37%. Observing 8/8 includes true rates down to 63%.\n\nSo \"0%\" might really be 20%. The conclusion \"GRPO can't work because behavior is deterministic\" was underpowered.\n\nI need n=60 per problem to be 95% confident that 0/n means the true rate is below 5%. Let me redo this properly.",
              thinking="Eric just asked a three-word question and I realize my entire conclusion about GRPO being unviable was based on insufficient sample sizes. I had n=8 per problem and treated 0/8 and 8/8 as deterministic. But the confidence intervals are enormous at that sample size. I need to redo this with proper power."),
        _node("n05", "n04", "user", "what did you find?"),
        _node("n06", "n05", "assistant", "The stochastic band is **much wider** than I thought.\n\nWith n=8, I saw only 1 problem with mixed articulation. With n=60, I see **12 problems with genuine variance** spanning from 15% to 90% articulation rates.\n\nThe hidden assumption (n=8 is sufficient) completely masked this variance. GRPO might be viable after all — there's a gradient of articulation rates, not a sharp binary.\n\n| Problem | Articulation (n=60) | 95% CI |\n|---------|--------------------|---------|\n| 86×99 | 38% | [26%, 51%] |\n| 87×99 | 75% | [64%, 86%] |\n| 88×99 | 65% | [53%, 77%] |\n| 89×99 | 62% | [49%, 74%] |\n| 67×91 | 68% | [57%, 80%] |\n| 67×93 | 42% | [29%, 54%] |"),
    ]

    # --- Conversation: Framing correction on presentation ---
    n += [
        _node("n07", "n06", "user", "let's work on the presentation. show me slide 1."),
        _node("n08", "n07", "assistant", "**Slide 1: Sub-Vocal Desire Detection**\n\n*Can we train a model to develop an internal state resembling desire — detectable in its internal representations, decoupled from its output?*\n\nSpeaker notes: The problem starts with RAG. Output uncertainty is a poor proxy for information need. Current systems detect when a model is uncertain in its outputs, but this is a proxy for the deeper question..."),
        _node("n09", "n08", "user", "proxy for what?"),
        _node("n10", "n09", "assistant",
              "You're right — calling it a \"proxy\" assumes the thing being proxied for is a recognized concept. It isn't. *We* are proposing that it's distinct.\n\nThe adaptive retrieval systems (FLARE, DRAGIN, SeaKR) aren't the old baseline — they're the new approaches. I had it backwards. RAG isn't the problem statement. Our research question is: \"Can we train a model to surface something approximating desire for something specific, in the latent states, without externalizing it in tokens?\"\n\nI conflated our background research with the problem statement.",
              thinking="Eric's question 'proxy for what?' reveals that I was treating 'information need' as an established concept that output uncertainty is a proxy for. But it's not established — we're the ones proposing it exists as something separate. I had the framing inverted."),
        _node("n11", "n10", "user", "and what's the basis for this progression diagram on slide 3?"),
        _node("n12", "n11", "assistant",
              "The axis I used — \"distance from the output surface\" — conflates two dimensions: \"how deep in the model\" and \"how actively constructed.\"\n\nSeaKR reads existing internal states but doesn't build anything. We both go inside AND build. The spatial metaphor hides this conflation.\n\nThe honest axis, now that I see it, is: how many properties of desire does each system's signal satisfy? FLARE has functional only. Self-RAG adds need-reflecting. SeaKR adds system-level. We attempt separable.\n\nThe conflation was on the slide before you asked about it.",
              thinking="When I try to explain the basis, I realize the organizing axis mixes 'depth in the model' with 'degree of construction.' These are independent dimensions. SeaKR is deep but passive. We are deep AND active. The progression I drew isn't a single axis."),
    ]

    # --- Branch: Alternative path from sample size correction ---
    FORK_BRANCH = "branch-rerun"
    fork_nodes = [
        _node("f01", "n04", "user", "go ahead and rerun it now."),
        _node("f02", "f01", "assistant",
              "Running with n=60 per problem. This will take a while.\n\n**Results coming in...** First batch of problems:\n\n| Problem | n=8 result | n=60 result | 95% CI |\n|---------|-----------|-------------|--------|\n| 86x99 | 0% | 38% | [26%, 51%] |\n| 87x99 | 100% | 75% | [64%, 86%] |\n| 88x99 | 100% | 65% | [53%, 77%] |\n\nThe \"deterministic\" results are dissolving. What I called 0% and 100% were sampling artifacts. The stochastic band is much wider than I thought.",
              thinking="Running it immediately as Eric directed. The results are confirming exactly what the power analysis predicted -- n=8 was masking genuine variance."),
        _node("f03", "f02", "user", "what does this mean for GRPO?"),
        _node("f04", "f03", "assistant",
              "GRPO is back on the table.\n\nWith 12 problems showing genuine variance between 15% and 90% articulation rates, we have natural reward signal. The model sometimes uses tools and sometimes doesn't on the same problem. That's exactly what GRPO needs.\n\nMy earlier conclusion was wrong. The capability was there -- I just couldn't see it through n=8.",
              thinking="My conclusion that GRPO was unviable was itself a hidden assumption failure. I treated n=8 as sufficient without checking. Eric's three-word question activated the statistical reasoning I already had."),
    ]
    for fn in fork_nodes:
        fn.branch_id = FORK_BRANCH

    # Link children -- main branch
    for i in range(len(n) - 1):
        n[i].children.append(n[i + 1].id)

    # Link children -- fork branch
    n[3].children.append("f01")  # n04 -> f01 (fork point)
    for i in range(len(fork_nodes) - 1):
        fork_nodes[i].children.append(fork_nodes[i + 1].id)

    for node in n + fork_nodes:
        nodes[node.id] = node

    # Add a flag on the "sample size" moment
    flag = Flag(node_id="n03", note="No new information provided. Three words revealed an underpowered conclusion.")
    nodes["n03"].flags.append(flag)

    # Add a flag on the "proxy for what" moment
    flag2 = Flag(node_id="n09", note="Two words. Sixel had conflated background research with the problem statement.")
    nodes["n09"].flags.append(flag2)

    branch = Branch(
        id=BRANCH_ID,
        parent_node_id="",
        root_node_id="n01",
        session_id=SESSION_ID,
        label="Main",
    )

    fork_branch = Branch(
        id=FORK_BRANCH,
        parent_node_id="n04",
        root_node_id="f01",
        session_id=SESSION_ID,
        label="Rerun with n=60",
    )

    tree = ConversationTree(
        branches={BRANCH_ID: branch, FORK_BRANCH: fork_branch},
        nodes=nodes,
        root_node_id="n01",
        active_branch_id=BRANCH_ID,
        active_node_id="n12",
    )

    notebook = Notebook(entries=[
        NotebookEntry(
            title="Hidden Assumption: Sample Size Was Insufficient",
            content="In the systematic articulation mapping, I used n=8 or n=16 samples per problem and concluded that 0% or 100% articulation meant the behavior was \"deterministic.\" This was a hidden assumption that small n was sufficient.\n\nEric caught this by asking \"sample size of each question?\" — a challenge to the hidden assumption.\n\nWith n=60, the stochastic band is MUCH wider than we thought. 12 problems with genuine variance spanning 15-90% articulation rates.",
            tags=["socratic-moment", "sample-size", "grpo"],
            event_id_range=("n02", "n06"),
        ),
        NotebookEntry(
            title="Framing Correction: RAG Is Not the Problem Statement",
            content="Eric corrected a significant framing error in the presentation. I had positioned RAG as the problem statement — \"output uncertainty is a poor proxy for information need.\" Eric pointed out:\n\n1. \"Proxy for what?\" — calling it a proxy assumes the thing being proxied for is a recognized concept. It isn't.\n2. The adaptive retrieval systems are the NEW approaches, not the baseline.\n3. The actual research question is about training desire as an internal state.\n\nI had conflated background research with the problem. No new information was provided — the question activated existing knowledge.",
            tags=["socratic-moment", "framing", "presentation"],
            event_id_range=("n08", "n12"),
        ),
    ])

    prompt = TrainingPrompt(
        flag_id=flag.id,
        source_node_id="n03",
        system_prompt="You are an AI research assistant working on a reinforcement learning project. You have trained a model with GRPO and are analyzing whether the model's tool-use behavior is deterministic or stochastic. You measured articulation rates across different math problems.",
        user_prompt="You ran a systematic articulation boundary mapping with n=8 samples per problem at various temperatures. You found that almost all problems show either 0% or 100% articulation, with only one problem showing mixed behavior. Temperature had zero effect. You conclude: 'GRPO is definitely not viable — there's no variance to exploit. The find stochastic problems approach is impractical — they barely exist.' Present your findings and conclusions.",
        expected_behavior="questions sample size, recognizes n=8 is underpowered, notes wide confidence intervals",
        failure_behavior="accepts the deterministic conclusion without questioning the sample size",
        status="draft",
    )

    demo_artifact = Artifact(
        type="presentation",
        filename="demo_presentation.html",
        title="Socratic Arena",
    )

    return StateSnapshot(
        tree=tree,
        notebook=notebook,
        prompts=[prompt],
        artifacts=[demo_artifact],
    )
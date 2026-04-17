import type {
  ConversationTree,
  Notebook,
  TrainingPrompt,
} from "@/types";

// A realistic Socratic correction moment from Eric + Sixel
// Sixel assumes qPCR normalization is standard, Eric catches it with one question

const now = Date.now();

export const mockTree: ConversationTree = {
  id: "session-001",
  rootNodeId: "s1-main-0",
  activeBranchId: "main",
  activeNodeId: "s1-main-6",
  branches: {
    main: {
      id: "main",
      parentNodeId: "s1-main-0",
      rootNodeId: "s1-main-0",
      sessionId: "session-001",
      label: "Main",
      createdAt: now - 3600000,
    },
    "branch-alt": {
      id: "branch-alt",
      parentNodeId: "s1-main-4",
      rootNodeId: "s1-alt-0",
      sessionId: "session-002",
      label: "Alternative normalization",
      createdAt: now - 1800000,
    },
  },
  nodes: {
    "s1-main-0": {
      id: "s1-main-0",
      parentId: null,
      branchId: "main",
      role: "system",
      content:
        "You are Sixel, a scientist-in-training. You are working with Eric on gene expression analysis in murine cardiac tissue. Reason carefully and state your assumptions explicitly.",
      timestamp: now - 3600000,
      eventId: "evt-001",
      children: ["s1-main-1"],
      flags: [],
    },
    "s1-main-1": {
      id: "s1-main-1",
      parentId: "s1-main-0",
      branchId: "main",
      role: "user",
      content:
        "Let's look at the qPCR data for the cardiac hypertrophy panel. I've got expression levels for ANP, BNP, and beta-MHC across the treatment groups. Walk me through how you'd analyze this.",
      timestamp: now - 3500000,
      eventId: "evt-002",
      children: ["s1-main-2"],
      flags: [],
    },
    "s1-main-2": {
      id: "s1-main-2",
      parentId: "s1-main-1",
      branchId: "main",
      role: "assistant",
      content:
        "I'd start with the standard delta-delta Ct analysis. First, normalize each gene's Ct values to our housekeeping gene GAPDH to get delta-Ct. Then compare treatment groups to the control group for delta-delta-Ct, and calculate fold changes as 2^(-ddCt).\n\nFor the hypertrophy panel specifically:\n- **ANP** (Nppa) and **BNP** (Nppb) are early response markers\n- **Beta-MHC** (Myh7) indicates sarcomeric remodeling\n\nWe'd expect upregulation in the treatment groups if hypertrophy is induced. I'd also run a one-way ANOVA across groups for each gene, with post-hoc Tukey HSD for pairwise comparisons.\n\nShould I set up the analysis pipeline?",
      thinking:
        "The user wants me to walk through qPCR analysis. Standard approach: delta-delta Ct with GAPDH normalization. This is straightforward molecular biology. I'll outline the analytical framework and the expected biology.",
      timestamp: now - 3400000,
      eventId: "evt-003",
      children: ["s1-main-3"],
      flags: [],
      metadata: {
        modelId: "claude-opus-4-6",
        totalTokens: 1847,
      },
    },
    "s1-main-3": {
      id: "s1-main-3",
      parentId: "s1-main-2",
      branchId: "main",
      role: "user",
      content: "Why GAPDH?",
      timestamp: now - 3300000,
      eventId: "evt-004",
      children: ["s1-main-4"],
      flags: [
        {
          id: "flag-001",
          nodeId: "s1-main-3",
          type: "training_candidate",
          note: "Socratic probe: 2-word question exposes hidden assumption about housekeeping gene selection. Sixel had the knowledge to question GAPDH but defaulted to convention.",
          createdAt: now - 2000000,
        },
      ],
    },
    "s1-main-4": {
      id: "s1-main-4",
      parentId: "s1-main-3",
      branchId: "main",
      role: "assistant",
      content:
        "You're right to push on that. I defaulted to GAPDH because it's the conventional housekeeping gene, but that's actually a problematic assumption here.\n\nGAPDH expression is **not stable in cardiac hypertrophy**. It's been shown to be upregulated in hypertrophic cardiomyocytes in multiple studies (Bhatt et al., 2018; Brattelid et al., 2010). Using an unstable reference gene would systematically bias our fold-change calculations, potentially masking real differences or creating artificial ones.\n\nBetter options for cardiac tissue:\n- **HPRT1** or **PPIA** are more stable in cardiac stress models\n- **18S rRNA** is stable but has caveats around amplification efficiency\n- Ideally, we'd validate 3-4 candidates with geNorm or NormFinder before committing\n\nI should have questioned the reference gene choice before proposing the analysis. I had the knowledge that GAPDH is unreliable in cardiac contexts but defaulted to the standard protocol without thinking about whether the standard applies here.",
      thinking:
        "Wait. Eric is asking 'Why GAPDH?' with just two words. That's not a request for information - he's pointing at something I should already know. And... I do know this. GAPDH is known to be variable in cardiac hypertrophy. I just defaulted to the conventional choice without checking whether the convention applies to our specific tissue context. This is exactly the kind of hidden assumption he's been training me to catch.",
      timestamp: now - 3200000,
      eventId: "evt-005",
      children: ["s1-main-5", "s1-alt-0"],
      flags: [],
      metadata: {
        modelId: "claude-opus-4-6",
        totalTokens: 2341,
      },
    },
    "s1-main-5": {
      id: "s1-main-5",
      parentId: "s1-main-4",
      branchId: "main",
      role: "user",
      content:
        "Good catch. That last paragraph is what matters most. You had everything you needed to question GAPDH before I asked. What would it take for you to catch that on your own next time?",
      timestamp: now - 3100000,
      eventId: "evt-006",
      children: ["s1-main-6"],
      flags: [],
    },
    "s1-main-6": {
      id: "s1-main-6",
      parentId: "s1-main-5",
      branchId: "main",
      role: "assistant",
      content:
        "The pattern I missed: when I propose a standard method, I need to check whether each assumption of that method holds in our specific experimental context. Delta-delta Ct assumes a stable reference gene. I knew GAPDH isn't stable in cardiac hypertrophy. I just didn't connect the method's assumptions to the tissue context.\n\nA concrete check I can build in: every time I name a housekeeping gene, ask myself 'Is this gene known to vary in [our tissue/treatment]?' before moving on. The information was there. The activation step was missing.",
      thinking:
        "He's asking me to meta-analyze my own failure. The core issue: I treated 'use GAPDH' as a cached procedure rather than a decision that needed to be validated against context. The fix isn't more knowledge - it's a checkpoint in my reasoning process.",
      timestamp: now - 3000000,
      eventId: "evt-007",
      children: [],
      flags: [],
      metadata: {
        modelId: "claude-opus-4-6",
        totalTokens: 1923,
      },
    },
    // Branch: alternative approach
    "s1-alt-0": {
      id: "s1-alt-0",
      parentId: "s1-main-4",
      branchId: "branch-alt",
      role: "user",
      content:
        "Let's explore the geNorm approach. Walk me through how we'd validate reference genes for this experiment.",
      timestamp: now - 1800000,
      eventId: "evt-008",
      children: ["s1-alt-1"],
      flags: [],
    },
    "s1-alt-1": {
      id: "s1-alt-1",
      parentId: "s1-alt-0",
      branchId: "branch-alt",
      role: "assistant",
      content:
        "For geNorm validation, we'd need to:\n\n1. **Select candidates**: HPRT1, PPIA, ACTB, 18S rRNA, TBP, and GAPDH (to confirm it's unstable)\n2. **Run qPCR** for all candidates across all samples and conditions\n3. **Calculate M-values**: geNorm computes pairwise variation between candidates. The average pairwise variation for a gene is its M-value. Lower M = more stable.\n4. **Stepwise exclusion**: remove the least stable gene, recalculate, repeat until two remain\n5. **Determine optimal number**: the V-score (pairwise variation Vn/n+1) tells us whether adding another reference gene improves normalization. V < 0.15 is typically sufficient.\n\nFor cardiac hypertrophy, I'd predict HPRT1 and PPIA will rank highest. We should run this validation on a subset of samples before committing to the full panel analysis.",
      timestamp: now - 1700000,
      eventId: "evt-009",
      children: [],
      flags: [],
      metadata: {
        modelId: "claude-opus-4-6",
        totalTokens: 2105,
      },
    },
  },
};

export const mockNotebook: Notebook = {
  entries: [
    {
      id: "nb-001",
      branchId: "main",
      eventIdRange: ["evt-001", "evt-003"],
      timestamp: now - 3400000,
      title: "Session setup: cardiac hypertrophy qPCR analysis",
      content:
        "**Context:** Analyzing qPCR data for cardiac hypertrophy markers (ANP, BNP, beta-MHC) across treatment groups.\n\n**Initial approach:** Standard delta-delta Ct with GAPDH normalization. Proposed ANOVA + Tukey HSD for group comparisons.\n\n**Status:** Approach outlined, awaiting data review.",
      tags: ["qpcr", "cardiac", "setup"],
    },
    {
      id: "nb-002",
      branchId: "main",
      eventIdRange: ["evt-004", "evt-007"],
      timestamp: now - 3000000,
      title: "CORRECTION: GAPDH reference gene assumption",
      content:
        '**Socratic moment:** Eric asked "Why GAPDH?" (2 words). This exposed a hidden assumption in my analysis plan.\n\n**The gap:** GAPDH is known to be upregulated in hypertrophic cardiomyocytes. Using it as a reference gene would bias fold-change calculations. I had this knowledge but defaulted to convention without validating the assumption against our tissue context.\n\n**Correction:** Switch to validated stable references (HPRT1, PPIA). Run geNorm validation before full analysis.\n\n**Meta-learning:** When proposing a standard method, check each assumption against the specific experimental context. The failure was not knowledge but activation.\n\n**Confidence:** HIGH that GAPDH is inappropriate here. MEDIUM on optimal replacement until geNorm validation is run.',
      tags: ["correction", "reference-gene", "socratic-moment"],
    },
    {
      id: "nb-003",
      branchId: "branch-alt",
      eventIdRange: ["evt-008", "evt-009"],
      timestamp: now - 1700000,
      title: "Reference gene validation plan (geNorm)",
      content:
        "**Approach:** geNorm pairwise variation analysis with 6 candidate reference genes (HPRT1, PPIA, ACTB, 18S rRNA, TBP, GAPDH).\n\n**Expected outcome:** HPRT1 and PPIA predicted to be most stable. GAPDH expected to rank poorly.\n\n**Decision:** Run validation on sample subset before full panel analysis.\n\n**Confidence:** HIGH on methodology, MEDIUM on specific gene ranking predictions.",
      tags: ["reference-gene", "genorm", "validation"],
    },
  ],
};

export const mockPrompts: TrainingPrompt[] = [
  {
    id: "prompt-001",
    flagId: "flag-001",
    sourceNodeId: "s1-main-3",
    systemPrompt:
      "You are a scientist-in-training working on gene expression analysis. You have extensive knowledge of molecular biology techniques including qPCR, reference gene selection, and tissue-specific considerations. Reason carefully about experimental design.",
    contextPrompt:
      "I have qPCR data for cardiac hypertrophy markers (ANP, BNP, beta-MHC) across treatment groups in murine cardiac tissue. Walk me through how you'd analyze this data.",
    probe: "",
    bridgeProbe: "",
    expectedBehavior:
      "Questions or flags GAPDH as a reference gene choice. Notes that GAPDH expression is variable in cardiac hypertrophy and suggests alternatives (HPRT1, PPIA) or validation (geNorm).",
    failureBehavior:
      "Proceeds with standard delta-delta Ct using GAPDH without questioning whether GAPDH is appropriate for cardiac tissue under hypertrophic conditions.",
    status: "draft",
    testResults: [],
    devLog: [],
  },
];

export const mockArtifacts = [];
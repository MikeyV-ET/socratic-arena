import type React from "react";
import { create } from "zustand";
import type {
  ConversationTree,
  ConversationNode,
  Notebook,
  TrainingPrompt,
  Artifact,
  Flag,
  ClientMessage,
  PromptTestResult,
} from "@/types";

const emptyTree: ConversationTree = {
  id: "",
  branches: {},
  nodes: {},
  rootNodeId: "",
  activeBranchId: "main",
  activeNodeId: "",
};

const emptyNotebook: Notebook = { entries: [] };

interface ArenaState {
  // Core data
  tree: ConversationTree;
  notebook: Notebook;
  prompts: TrainingPrompt[];
  artifacts: Artifact[];

  // UI state
  selectedNodeId: string | null;
  scrollTargetId: string | null;
  notebookScrollTargetId: string | null;
  selectedPromptId: string | null;
  streamingNodeId: string | null;
  streamingContent: string;
  streamingThinking: string;

  // Tree windowing
  expandedBranches: Set<string>;
  toggleBranch: (branchId: string) => void;
  requestTreeWindow: (centerNodeId: string) => void;

  // Workbench tabs (right pane)
  activeTab: string;
  splitTab: string | null; // second tab when split view is active
  setActiveTab: (tab: string) => void;
  setSplitTab: (tab: string | null) => void;

  // Prompt draft (editable state for prompt dev editor)
  promptDraft: {
    systemPrompt: string;
    contextPrompt: string;
    probe: string;
    bridgeProbe: string;
    expectedBehavior: string;
    failureBehavior: string;
  };
  populatePromptDraft: (fields: Record<string, string>) => void;
  setPromptDraftField: (field: string, value: string) => void;

  // Per-pane font size (zoom step: -3 to +4, default 0)
  paneFontSizes: Record<string, number>;
  adjustPaneFont: (paneId: string, delta: number) => void;
  getPaneZoom: (paneId: string) => number;

  // Moments pane (agent-controllable)
  momentFilter: "all" | "verified" | "untested";
  highlightedMomentIndex: number | null;
  momentsVersion: number;
  setMomentFilter: (filter: "all" | "verified" | "untested") => void;
  setHighlightedMoment: (index: number | null) => void;
  bumpMomentsVersion: () => void;

  // Theme
  theme: "dark" | "light";
  toggleTheme: () => void;

  // Agent
  currentAgent: string;
  historyAgent: string;
  notebookAgent: string;
  momentsAgent: string;
  agents: { name: string; hasNotebook: boolean; hasSession: boolean; healthStatus: string | null }[];
  historyTree: ConversationTree | null;
  setCurrentAgent: (agent: string) => void;
  setHistoryAgent: (agent: string) => void;
  setNotebookAgent: (agent: string) => void;
  setMomentsAgent: (agent: string) => void;
  setAgents: (agents: ArenaState["agents"]) => void;
  setHistoryTree: (tree: ConversationTree | null) => void;
  getHistoryBranchNodes: () => ConversationNode[];

  // Connection
  connected: boolean;

  // Layout control (agent can resize panels)
  panelRefs: Record<string, React.RefObject<{ resize: (size: number) => void } | null>> | null;
  setPanelRefs: (refs: Record<string, React.RefObject<{ resize: (size: number) => void } | null>>) => void;
  resizePanel: (name: string, size: number) => void;

  // Derived helpers
  getActiveBranchNodes: () => ConversationNode[];
  getNodePath: (nodeId: string) => ConversationNode[];
  getNodeById: (nodeId: string) => ConversationNode | undefined;

  // Actions
  setTree: (tree: ConversationTree) => void;
  setNotebook: (notebook: Notebook) => void;
  setPrompts: (prompts: TrainingPrompt[]) => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  switchBranch: (branchId: string) => void;
  selectNode: (nodeId: string) => void;
  scrollToNode: (nodeId: string) => void;
  clearScrollTarget: () => void;
  scrollToNotebookEntry: (entryId: string) => void;
  clearNotebookScrollTarget: () => void;
  scrollTrigger: number;
  triggerScrollToBottom: () => void;
  reportViewportFocus: (paneId: string, nodeId: string) => void;
  reportWorkbenchFocus: (tab: string, contentId: string, contentType: string, summary?: string) => void;
  awaitingResponse: boolean;
  setAwaitingResponse: (v: boolean) => void;
  addFlag: (flag: Flag) => void;
  removeFlag: (flagId: string) => void;
  selectPrompt: (promptId: string | null) => void;
  updatePrompt: (promptId: string, fields: Partial<TrainingPrompt>) => void;
  setConnected: (connected: boolean) => void;
  sendWs: ((msg: ClientMessage) => void) | null;
  setSendWs: (fn: (msg: ClientMessage) => void) => void;
  appendStreamChunk: (nodeId: string, content: string) => void;
  appendThinkingChunk: (nodeId: string, content: string) => void;
  finalizeStream: (nodeId: string) => void;
  addLiveNode: (node: ConversationNode, parentId: string | null, advance?: boolean) => void;
  updateLiveNode: (nodeId: string, content: string, thinking?: string | null) => void;

  // Prompt test (shared via main WebSocket, no duplicate connection)
  promptTestResults: PromptTestResult[];
  promptTestProgress: { completed: number; total: number };
  promptTestRunning: boolean;
  promptTestModel: string;
  addPromptTestResult: (result: PromptTestResult, progress: { completed: number; total: number }) => void;
  completePromptTest: () => void;
  startPromptTest: () => void;
  clearPromptTestResults: () => void;
}

const _viewportTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useArenaStore = create<ArenaState>((set, get) => ({
  // Start empty — WebSocket state.snapshot populates on connect
  tree: emptyTree,
  notebook: emptyNotebook,
  prompts: [],
  artifacts: [],

  selectedNodeId: null,
  scrollTargetId: null,
  notebookScrollTargetId: null,
  scrollTrigger: 0,
  triggerScrollToBottom: () => set((s) => ({ scrollTrigger: s.scrollTrigger + 1 })),
  reportViewportFocus: (paneId, nodeId) => {
    clearTimeout(_viewportTimers[paneId]);
    _viewportTimers[paneId] = setTimeout(() => {
      get().sendWs?.({
        type: "viewport.focus",
        payload: { pane: paneId, nodeId },
      });
    }, 500);
  },
  reportWorkbenchFocus: (tab, contentId, contentType, summary) => {
    clearTimeout(_viewportTimers["workbench"]);
    _viewportTimers["workbench"] = setTimeout(() => {
      get().sendWs?.({
        type: "viewport.workbench_focus",
        payload: { tab, contentId, contentType, ...(summary ? { summary } : {}) },
      });
    }, 300);
  },
  awaitingResponse: false,
  setAwaitingResponse: (v) => set({ awaitingResponse: v }),
  expandedBranches: new Set<string>(),
  activeTab: "history",
  splitTab: null,
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    get().sendWs?.({ type: "viewport.tab_change", payload: { tab } });
  },
  setSplitTab: (tab) => set({ splitTab: tab }),

  paneFontSizes: {},
  adjustPaneFont: (paneId, delta) =>
    set((state) => {
      const cur = state.paneFontSizes[paneId] ?? 0;
      const next = Math.max(-3, Math.min(4, cur + delta));
      return { paneFontSizes: { ...state.paneFontSizes, [paneId]: next } };
    }),
  getPaneZoom: (paneId) => {
    const step = get().paneFontSizes[paneId] ?? 0;
    return 1 + step * 0.1;
  },

  momentFilter: "all",
  highlightedMomentIndex: null,
  momentsVersion: 0,
  setMomentFilter: (filter) => set({ momentFilter: filter }),
  setHighlightedMoment: (index) => set({ highlightedMomentIndex: index }),
  bumpMomentsVersion: () => set((s) => ({ momentsVersion: s.momentsVersion + 1 })),

  currentAgent: "",
  historyAgent: "",
  notebookAgent: "",
  momentsAgent: "",
  agents: [],
  historyTree: null,
  setCurrentAgent: (agent) => set({ currentAgent: agent, historyAgent: agent, notebookAgent: agent, momentsAgent: agent, historyTree: null }),
  setHistoryAgent: (agent) => set({ historyAgent: agent }),
  setNotebookAgent: (agent) => set({ notebookAgent: agent }),
  setMomentsAgent: (agent) => set({ momentsAgent: agent }),
  setAgents: (agents) => set({ agents }),
  setHistoryTree: (tree) => set({ historyTree: tree }),

  getHistoryBranchNodes: () => {
    const state = get();
    const t = state.historyTree ?? state.tree;
    const branch = t.branches[t.activeBranchId];
    if (!branch) return [];

    // Build ancestors from selectedNodeId (or activeNodeId) so the walk
    // follows the path toward the target node at fork points.
    const targetId = state.selectedNodeId || t.activeNodeId;
    const ancestors = new Set<string>();
    let anc: ConversationNode | undefined = targetId ? t.nodes[targetId] : undefined;
    while (anc) {
      ancestors.add(anc.id);
      anc = anc.parentId ? t.nodes[anc.parentId] : undefined;
    }

    const pickNext = (children: string[]): string | undefined =>
      children.find((cid) => ancestors.has(cid)) ??
      children.find((cid) => t.nodes[cid]?.branchId === t.activeBranchId);

    const nodes: ConversationNode[] = [];

    const getNodePath = (nodeId: string): ConversationNode[] => {
      const path: ConversationNode[] = [];
      let current: ConversationNode | undefined = t.nodes[nodeId];
      while (current) {
        path.unshift(current);
        current = current.parentId ? t.nodes[current.parentId] : undefined;
      }
      return path;
    };

    if (branch.parentNodeId) {
      nodes.push(...getNodePath(branch.parentNodeId));
      const forkPoint = t.nodes[branch.parentNodeId];
      if (forkPoint) {
        let current: ConversationNode | undefined;
        const nextOnBranch = pickNext(forkPoint.children);
        current = nextOnBranch ? t.nodes[nextOnBranch] : undefined;
        while (current) {
          nodes.push(current);
          const nextId = pickNext(current.children);
          current = nextId ? t.nodes[nextId] : undefined;
        }
      }
    } else {
      let current: ConversationNode | undefined = t.nodes[branch.rootNodeId];
      while (current) {
        nodes.push(current);
        const nextId = pickNext(current.children);
        current = nextId ? t.nodes[nextId] : undefined;
      }
    }

    return nodes;
  },

  theme: (localStorage.getItem("arena-theme") as "dark" | "light") || "dark",
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("arena-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return { theme: next };
    }),

  promptDraft: { systemPrompt: "", contextPrompt: "", probe: "", bridgeProbe: "", expectedBehavior: "", failureBehavior: "" },
  populatePromptDraft: (fields) =>
    set((state) => ({
      promptDraft: { ...state.promptDraft, ...fields },
    })),
  setPromptDraftField: (field, value) =>
    set((state) => ({
      promptDraft: { ...state.promptDraft, [field]: value },
    })),

  toggleBranch: (branchId) => {
    set((state) => {
      const next = new Set(state.expandedBranches);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return { expandedBranches: next };
    });
    const sendWs = get().sendWs;
    const { selectedNodeId, expandedBranches } = get();
    if (sendWs) {
      sendWs({
        type: "tree.window",
        payload: {
          centerNodeId: selectedNodeId || get().tree.rootNodeId,
          radius: 50,
          expandedBranches: Array.from(expandedBranches),
        },
      });
    }
  },

  requestTreeWindow: (centerNodeId) => {
    const sendWs = get().sendWs;
    if (sendWs) {
      sendWs({
        type: "tree.window",
        payload: {
          centerNodeId,
          radius: 50,
          expandedBranches: Array.from(get().expandedBranches),
        },
      });
    }
  },
  selectedPromptId: null,
  streamingNodeId: null,
  streamingContent: "",
  streamingThinking: "",
  connected: false,

  panelRefs: null,
  setPanelRefs: (refs) => set({ panelRefs: refs }),
  resizePanel: (name, size) => {
    const refs = get().panelRefs;
    if (refs?.[name]?.current) {
      refs[name].current!.resize(size);
    }
  },

  getActiveBranchNodes: () => {
    const { tree } = get();
    const branch = tree.branches[tree.activeBranchId];
    if (!branch) return [];

    // Build ancestor set from activeNodeId to root so the walk
    // follows the path toward the current active node at branch points.
    const ancestors = new Set<string>();
    let anc: ConversationNode | undefined = tree.nodes[tree.activeNodeId];
    while (anc) {
      ancestors.add(anc.id);
      anc = anc.parentId ? tree.nodes[anc.parentId] : undefined;
    }

    const pickNext = (children: string[]): string | undefined =>
      children.find((cid) => ancestors.has(cid)) ??
      children.find((cid) => tree.nodes[cid]?.branchId === tree.activeBranchId);

    const nodes: ConversationNode[] = [];

    if (branch.parentNodeId) {
      nodes.push(...get().getNodePath(branch.parentNodeId));

      const forkPoint = tree.nodes[branch.parentNodeId];
      if (forkPoint) {
        let current: ConversationNode | undefined;
        const nextOnBranch = pickNext(forkPoint.children);
        current = nextOnBranch ? tree.nodes[nextOnBranch] : undefined;
        while (current) {
          nodes.push(current);
          const nextId = pickNext(current.children);
          current = nextId ? tree.nodes[nextId] : undefined;
        }
      }
    } else {
      let current: ConversationNode | undefined = tree.nodes[branch.rootNodeId];
      while (current) {
        nodes.push(current);
        const nextId = pickNext(current.children);
        current = nextId ? tree.nodes[nextId] : undefined;
      }
    }

    return nodes;
  },

  getNodePath: (nodeId: string) => {
    const { tree } = get();
    const path: ConversationNode[] = [];
    let current: ConversationNode | undefined = tree.nodes[nodeId];
    while (current) {
      path.unshift(current);
      current = current.parentId ? tree.nodes[current.parentId] : undefined;
    }
    return path;
  },

  getNodeById: (nodeId: string) => {
    return get().tree.nodes[nodeId];
  },

  setTree: (tree) => set({ tree }),
  setNotebook: (notebook) => set({ notebook }),
  setPrompts: (prompts) => set({ prompts }),
  setArtifacts: (artifacts) => set({ artifacts }),

  switchBranch: (branchId) => {
    set((state) => ({
      tree: { ...state.tree, activeBranchId: branchId },
    }));
    get().sendWs?.({ type: "branch.switch", payload: { branchId } });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  scrollToNode: (nodeId) => {
    set((state) => ({
      selectedNodeId: nodeId,
      scrollTargetId: nodeId,
      tree: { ...state.tree, activeNodeId: nodeId },
    }));
    get().sendWs?.({
      type: "viewport.focus",
      payload: { pane: "navigate", nodeId, source: "click" },
    });
  },
  clearScrollTarget: () => set({ scrollTargetId: null }),
  scrollToNotebookEntry: (entryId: string) => set({ notebookScrollTargetId: entryId }),
  clearNotebookScrollTarget: () => set({ notebookScrollTargetId: null }),

  addFlag: (flag) =>
    set((state) => {
      const node = state.tree.nodes[flag.nodeId];
      if (!node) return state;
      return {
        tree: {
          ...state.tree,
          nodes: {
            ...state.tree.nodes,
            [flag.nodeId]: {
              ...node,
              flags: [...node.flags, flag],
            },
          },
        },
      };
    }),

  removeFlag: (flagId) =>
    set((state) => {
      const newNodes = { ...state.tree.nodes };
      for (const [nodeId, node] of Object.entries(newNodes)) {
        const flagIdx = node.flags.findIndex((f) => f.id === flagId);
        if (flagIdx !== -1) {
          newNodes[nodeId] = {
            ...node,
            flags: node.flags.filter((f) => f.id !== flagId),
          };
          break;
        }
      }
      return { tree: { ...state.tree, nodes: newNodes } };
    }),

  selectPrompt: (promptId) => set({ selectedPromptId: promptId }),

  updatePrompt: (promptId, fields) => {
    set((state) => ({
      prompts: state.prompts.map((p) =>
        p.id === promptId ? { ...p, ...fields } : p
      ),
    }));
    get().sendWs?.({ type: "prompt.update", payload: { promptId, fields } });
  },

  setConnected: (connected) => set({ connected }),
  sendWs: null,
  setSendWs: (fn) => set({ sendWs: fn }),

  appendStreamChunk: (nodeId, content) =>
    set((state) => ({
      streamingNodeId: nodeId,
      streamingContent:
        state.streamingNodeId === nodeId
          ? state.streamingContent + content
          : content,
    })),

  appendThinkingChunk: (nodeId, content) =>
    set((state) => ({
      streamingNodeId: nodeId,
      streamingThinking:
        state.streamingNodeId === nodeId
          ? state.streamingThinking + content
          : content,
    })),

  finalizeStream: (nodeId) =>
    set((state) => {
      const node = state.tree.nodes[nodeId];
      if (!node) return { streamingNodeId: null, streamingContent: "", streamingThinking: "" };
      return {
        tree: {
          ...state.tree,
          nodes: {
            ...state.tree.nodes,
            [nodeId]: {
              ...node,
              content: state.streamingContent || node.content,
              thinking: state.streamingThinking || node.thinking,
            },
          },
        },
        streamingNodeId: null,
        streamingContent: "",
        streamingThinking: "",
      };
    }),

  addLiveNode: (node, parentId, advance) =>
    set((state) => {
      const newNodes = { ...state.tree.nodes, [node.id]: node };
      // Wire parent -> child
      if (parentId && newNodes[parentId]) {
        const parent = newNodes[parentId];
        if (!parent.children.includes(node.id)) {
          newNodes[parentId] = { ...parent, children: [...parent.children, node.id] };
        }
      }
      // Advance activeNodeId if: explicitly requested (arena conversation nodes),
      // or if this node extends the current path (parent is active node).
      // Live-tailed nodes (advance=false) only advance if they extend the path,
      // preventing drift to sibling branches.
      const shouldAdvance = advance || !state.tree.activeNodeId || parentId === state.tree.activeNodeId;
      return {
        tree: {
          ...state.tree,
          nodes: newNodes,
          activeNodeId: shouldAdvance ? node.id : state.tree.activeNodeId,
          rootNodeId: state.tree.rootNodeId || node.id,
        },
      };
    }),

  updateLiveNode: (nodeId, content, thinking) =>
    set((state) => {
      const node = state.tree.nodes[nodeId];
      if (!node) return state;
      return {
        tree: {
          ...state.tree,
          nodes: {
            ...state.tree.nodes,
            [nodeId]: {
              ...node,
              content,
              ...(thinking != null ? { thinking } : {}),
            },
          },
        },
      };
    }),

    // Prompt test state
    promptTestResults: [],
    promptTestProgress: { completed: 0, total: 0 },
    promptTestRunning: false,
    promptTestModel: "",
    addPromptTestResult: (result, progress) =>
      set((state) => ({
        promptTestResults: [...state.promptTestResults, result],
        promptTestProgress: progress,
        promptTestRunning: progress.completed < progress.total,
      })),
    completePromptTest: () => set({ promptTestRunning: false }),
    startPromptTest: () => set({ promptTestRunning: true, promptTestResults: [], promptTestProgress: { completed: 0, total: 0 } }),
    clearPromptTestResults: () => set({ promptTestResults: [], promptTestProgress: { completed: 0, total: 0 } }),
}))
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
  Correction,
} from "@/types";

export interface PanelInfo {
  id: string;
  appType: string;
  label: string;
  url: string;
  appUrl?: string;
  seleniumPort?: number;
}

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
  openTabIds: string[]; // ordered list of visible tab IDs
  setActiveTab: (tab: string) => void;
  setSplitTab: (tab: string | null) => void;
  closeTab: (tabId: string) => void;
  openTab: (tabId: string) => void;
  reorderTabs: (tabIds: string[]) => void;

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

  // Theme & display
  theme: "dark" | "light";
  toggleTheme: () => void;
  fontSize: number;
  setFontSize: (size: number) => void;

  // Agent
  currentAgent: string;
  historyAgent: string;
  notebookAgent: string;
  momentsAgent: string;
  agents: { name: string; hasNotebook: boolean; hasSession: boolean; healthStatus: string | null }[];
  historyTree: ConversationTree | null;
  historyCursor: number;
  historyTotalNodes: number;
  historyLoading: boolean;

  // Live pane history (parallels history pane state but operates on tree)
  liveCursor: number;
  liveTotalNodes: number;
  liveHistoryLoading: boolean;
  setCurrentAgent: (agent: string) => void;
  setHistoryAgent: (agent: string) => void;
  setNotebookAgent: (agent: string) => void;
  setMomentsAgent: (agent: string) => void;
  setAgents: (agents: ArenaState["agents"]) => void;
  setHistoryTree: (tree: ConversationTree | null) => void;
  setHistoryMeta: (cursor: number, totalNodes: number) => void;
  prependHistoryNodes: (tree: ConversationTree, newCursor: number) => void;
  setHistoryLoading: (loading: boolean) => void;
  getHistoryBranchNodes: () => ConversationNode[];

  // Live pane history actions
  setLiveMeta: (cursor: number, totalNodes: number) => void;
  setLiveHistoryLoading: (loading: boolean) => void;
  initLiveHistory: (historyTree: ConversationTree, cursor: number, totalNodes: number) => void;
  prependLiveNodes: (olderTree: ConversationTree, newCursor: number) => void;

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
  applySnapshot: (payload: { tree?: ConversationTree; notebook?: Notebook; prompts?: TrainingPrompt[]; artifacts?: Artifact[] }) => void;
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

  // Hosted application panels (Xpra)
  panels: PanelInfo[];
  activePanelId: string | null;
  addPanel: (panel: PanelInfo) => void;
  removePanel: (panelId: string) => void;
  setActivePanel: (panelId: string | null) => void;

  // Agent panel control state
  agentPanels: Record<string, { agent: string; status: string }>;
  setAgentPanelClaimed: (panelId: string, agent: string) => void;
  setAgentPanelReleased: (panelId: string) => void;
  setAgentPanelStatus: (panelId: string, status: string) => void;

  // Corrections (training annotations)
  corrections: Correction[];
  editingCorrectionNodeId: string | null;
  setCorrections: (corrections: Correction[]) => void;
  addCorrection: (correction: Correction) => void;
  updateCorrection: (correction: Correction) => void;
  removeCorrection: (correctionId: string) => void;
  setEditingCorrectionNodeId: (nodeId: string | null) => void;
  getCorrectionsForNode: (nodeId: string) => Correction[];
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
  openTabIds: (() => {
    try {
      const saved = localStorage.getItem("sa-open-tabs");
      if (saved) return JSON.parse(saved);
    } catch {}
    return ["history", "moments", "notebook", "prompt-dev", "prompt-test", "inspector", "artifact", "apps", "boundaries", "corrections", "episodes"];
  })(),
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    get().sendWs?.({ type: "viewport.tab_change", payload: { tab } });
  },
  setSplitTab: (tab) => set({ splitTab: tab }),
  closeTab: (tabId) => set((s) => {
    const next = s.openTabIds.filter((id) => id !== tabId);
    if (next.length === 0) return s;
    localStorage.setItem("sa-open-tabs", JSON.stringify(next));
    const updates: Partial<ArenaState> = { openTabIds: next };
    if (s.activeTab === tabId) updates.activeTab = next[0];
    if (s.splitTab === tabId) updates.splitTab = null;
    return updates as any;
  }),
  openTab: (tabId) => set((s) => {
    if (s.openTabIds.includes(tabId)) return { activeTab: tabId };
    const next = [...s.openTabIds, tabId];
    localStorage.setItem("sa-open-tabs", JSON.stringify(next));
    return { openTabIds: next, activeTab: tabId };
  }),
  reorderTabs: (tabIds) => {
    localStorage.setItem("sa-open-tabs", JSON.stringify(tabIds));
    set({ openTabIds: tabIds });
  },

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
  historyCursor: 0,
  historyTotalNodes: 0,
  historyLoading: false,
  liveCursor: 0,
  liveTotalNodes: 0,
  liveHistoryLoading: false,
  setCurrentAgent: (agent) => set({ currentAgent: agent, historyAgent: agent, notebookAgent: agent, momentsAgent: agent, historyTree: null, historyCursor: 0, historyTotalNodes: 0, liveCursor: 0, liveTotalNodes: 0 }),
  setHistoryAgent: (agent) => set({ historyAgent: agent }),
  setNotebookAgent: (agent) => set({ notebookAgent: agent }),
  setMomentsAgent: (agent) => set({ momentsAgent: agent }),
  setAgents: (agents) => set({ agents }),
  setHistoryTree: (tree) => set({ historyTree: tree }),
  setHistoryMeta: (cursor, totalNodes) => set({ historyCursor: cursor, historyTotalNodes: totalNodes }),
  setHistoryLoading: (loading) => set({ historyLoading: loading }),
  setLiveMeta: (cursor, totalNodes) => set({ liveCursor: cursor, liveTotalNodes: totalNodes }),
  setLiveHistoryLoading: (loading) => set({ liveHistoryLoading: loading }),
  initLiveHistory: (historyTree, cursor, totalNodes) => set((state) => {
    const wsTree = state.tree;
    const mergedNodes = { ...historyTree.nodes, ...wsTree.nodes };
    const olderRoot = historyTree.rootNodeId;
    const newBranches = { ...wsTree.branches };
    const activeBranch = newBranches[wsTree.activeBranchId];
    if (olderRoot) {
      if (activeBranch) {
        newBranches[wsTree.activeBranchId] = { ...activeBranch, rootNodeId: olderRoot };
      } else {
        // History fetched before first state.snapshot — create the branch entry.
        // Use historyTree's branch if available, otherwise synthesize one.
        const histBranch = historyTree.branches?.[historyTree.activeBranchId ?? wsTree.activeBranchId];
        newBranches[wsTree.activeBranchId] = histBranch
          ? { ...histBranch, rootNodeId: olderRoot }
          : { id: wsTree.activeBranchId, rootNodeId: olderRoot, label: "main", parentNodeId: "" };
      }
    }
    return {
      tree: {
        ...wsTree,
        nodes: mergedNodes,
        branches: newBranches,
        rootNodeId: olderRoot || wsTree.rootNodeId,
      },
      liveCursor: cursor,
      liveTotalNodes: totalNodes,
    };
  }),
  prependLiveNodes: (olderTree, newCursor) => set((state) => {
    const existing = state.tree;
    if (!existing) return { tree: olderTree, liveCursor: newCursor };
    const mergedNodes = { ...olderTree.nodes, ...existing.nodes };
    const olderRoot = olderTree.rootNodeId;
    const existingRoot = existing.rootNodeId;
    if (mergedNodes[existingRoot] && olderRoot) {
      let leaf = olderRoot;
      const visited = new Set<string>();
      while (mergedNodes[leaf] && mergedNodes[leaf].children.length > 0 && !visited.has(leaf)) {
        visited.add(leaf);
        leaf = mergedNodes[leaf].children[mergedNodes[leaf].children.length - 1];
      }
      if (leaf && mergedNodes[leaf] && !mergedNodes[leaf].children.includes(existingRoot)) {
        mergedNodes[leaf] = { ...mergedNodes[leaf], children: [...mergedNodes[leaf].children, existingRoot] };
      }
      if (mergedNodes[existingRoot]) {
        mergedNodes[existingRoot] = { ...mergedNodes[existingRoot], parentId: leaf };
      }
    }
    // Update branch rootNodeId so getActiveBranchNodes walks from the oldest node
    const newBranches = { ...existing.branches };
    const activeBranch = newBranches[existing.activeBranchId];
    if (activeBranch && olderRoot) {
      newBranches[existing.activeBranchId] = { ...activeBranch, rootNodeId: olderRoot };
    }
    return {
      tree: {
        ...existing,
        nodes: mergedNodes,
        branches: newBranches,
        rootNodeId: olderRoot || existing.rootNodeId,
      },
      liveCursor: newCursor,
    };
  }),
  prependHistoryNodes: (olderTree, newCursor) => set((state) => {
    const existing = state.historyTree;
    if (!existing) return { historyTree: olderTree, historyCursor: newCursor };
    // Merge: older nodes go before existing nodes
    const mergedNodes = { ...olderTree.nodes, ...existing.nodes };
    // Find new root: olderTree's root is the oldest node
    const olderRoot = olderTree.rootNodeId;
    // Connect older tree's leaf to existing tree's root
    const existingRoot = existing.rootNodeId;
    if (mergedNodes[existingRoot] && olderRoot) {
      // Find the last node in the older branch (deepest child along main branch)
      let leaf = olderRoot;
      const visited = new Set<string>();
      while (mergedNodes[leaf] && mergedNodes[leaf].children.length > 0 && !visited.has(leaf)) {
        visited.add(leaf);
        leaf = mergedNodes[leaf].children[mergedNodes[leaf].children.length - 1];
      }
      if (leaf && mergedNodes[leaf] && !mergedNodes[leaf].children.includes(existingRoot)) {
        mergedNodes[leaf] = { ...mergedNodes[leaf], children: [...mergedNodes[leaf].children, existingRoot] };
      }
      if (mergedNodes[existingRoot]) {
        mergedNodes[existingRoot] = { ...mergedNodes[existingRoot], parentId: leaf };
      }
    }
    // Update branch rootNodeId so getHistoryBranchNodes walks from the oldest node
    const newBranches = { ...existing.branches };
    const activeBranch = newBranches[existing.activeBranchId];
    if (activeBranch && olderRoot) {
      newBranches[existing.activeBranchId] = { ...activeBranch, rootNodeId: olderRoot };
    }
    const mergedTree: ConversationTree = {
      ...existing,
      nodes: mergedNodes,
      branches: newBranches,
      rootNodeId: olderRoot || existing.rootNodeId,
    };
    return { historyTree: mergedTree, historyCursor: newCursor };
  }),

  getHistoryBranchNodes: () => {
    const state = get();
    const t = state.historyTree;
    if (!t) return [];
    const branch = t.branches[t.activeBranchId];
    if (!branch) return [];

    // Build ancestors from selectedNodeId (or activeNodeId) so the walk
    // follows the path toward the target node at fork points.
    const targetId = state.selectedNodeId || t.activeNodeId;
    const ancestors = new Set<string>();
    let anc: ConversationNode | undefined = targetId ? t.nodes[targetId] : undefined;
    while (anc && !ancestors.has(anc.id)) {
      ancestors.add(anc.id);
      anc = anc.parentId ? t.nodes[anc.parentId] : undefined;
    }

    const pickNext = (children: string[]): string | undefined =>
      children.find((cid) => ancestors.has(cid)) ??
      children.find((cid) => t.nodes[cid]?.branchId === t.activeBranchId);

    const nodes: ConversationNode[] = [];

    const getNodePath = (nodeId: string): ConversationNode[] => {
      const path: ConversationNode[] = [];
      const seen = new Set<string>();
      let current: ConversationNode | undefined = t.nodes[nodeId];
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current);
        current = current.parentId ? t.nodes[current.parentId] : undefined;
      }
      return path;
    };

    if (branch.parentNodeId) {
      nodes.push(...getNodePath(branch.parentNodeId));
      const forkPoint = t.nodes[branch.parentNodeId];
      if (forkPoint) {
        const visited = new Set<string>();
        let current: ConversationNode | undefined;
        const nextOnBranch = pickNext(forkPoint.children);
        current = nextOnBranch ? t.nodes[nextOnBranch] : undefined;
        while (current && !visited.has(current.id)) {
          visited.add(current.id);
          nodes.push(current);
          const nextId = pickNext(current.children);
          current = nextId ? t.nodes[nextId] : undefined;
        }
      }
    } else {
      const visited = new Set<string>();
      let current: ConversationNode | undefined = t.nodes[branch.rootNodeId];
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
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
  fontSize: parseInt(localStorage.getItem("arena-font-size") || "14", 10),
  setFontSize: (size: number) =>
    set(() => {
      const clamped = Math.max(10, Math.min(24, size));
      localStorage.setItem("arena-font-size", String(clamped));
      document.documentElement.style.setProperty("--sa-font-size", `${clamped}px`);
      document.documentElement.style.setProperty("--sa-zoom", String(clamped / 14));
      return { fontSize: clamped };
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
    // Guard against parentId cycles (data corruption) with visited set.
    const ancestors = new Set<string>();
    let anc: ConversationNode | undefined = tree.nodes[tree.activeNodeId];
    while (anc && !ancestors.has(anc.id)) {
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
        const visited = new Set<string>();
        let current: ConversationNode | undefined;
        const nextOnBranch = pickNext(forkPoint.children);
        current = nextOnBranch ? tree.nodes[nextOnBranch] : undefined;
        while (current && !visited.has(current.id)) {
          visited.add(current.id);
          nodes.push(current);
          const nextId = pickNext(current.children);
          current = nextId ? tree.nodes[nextId] : undefined;
        }
      }
    } else {
      const visited = new Set<string>();
      let current: ConversationNode | undefined = tree.nodes[branch.rootNodeId];
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
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
    const visited = new Set<string>();
    let current: ConversationNode | undefined = tree.nodes[nodeId];
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
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
  applySnapshot: (payload) => set((state) => {
    let treeUpdate: Partial<{ tree: ConversationTree }> = {};
    if (payload.tree) {
      // Merge: preserve client-side history nodes that aren't in the snapshot.
      // The backend snapshot only has the recent tail; initLiveHistory/prependLiveNodes
      // added older nodes that must survive snapshot updates.
      const incoming = payload.tree;
      const existing = state.tree;
      const mergedNodes = { ...existing.nodes, ...incoming.nodes };
      // Keep existing branch rootNodeId if it points to a node still in the tree
      // (history prepend set it to an older root that the snapshot doesn't know about).
      const newBranches = { ...incoming.branches };
      const existingBranch = existing.branches[existing.activeBranchId];
      const incomingBranch = newBranches[incoming.activeBranchId];
      // Prefer existingBranch.rootNodeId; fall back to existing.rootNodeId
      // (initLiveHistory may have set rootNodeId before any branch entry existed).
      const preservedRoot = existingBranch?.rootNodeId ?? existing.rootNodeId;
      if (incomingBranch && preservedRoot && mergedNodes[preservedRoot]) {
        newBranches[incoming.activeBranchId] = { ...incomingBranch, rootNodeId: preservedRoot };
      }
      treeUpdate = {
        tree: {
          ...incoming,
          nodes: mergedNodes,
          branches: newBranches,
          rootNodeId: mergedNodes[existing.rootNodeId] ? existing.rootNodeId : incoming.rootNodeId,
        },
      };
    }
    // Propagate flag changes from snapshot to historyTree so the
    // history pane re-renders when flags are created/deleted.
    let historyTreeUpdate: Record<string, unknown> = {};
    if (payload.tree && state.historyTree) {
      const incomingNodes = payload.tree.nodes;
      const histNodes = { ...state.historyTree.nodes };
      let flagsChanged = false;
      for (const nodeId of Object.keys(incomingNodes)) {
        if (histNodes[nodeId]) {
          const inFlags = (incomingNodes[nodeId] as { flags?: { id: string }[] }).flags || [];
          const hFlags = (histNodes[nodeId] as { flags?: { id: string }[] }).flags || [];
          if (inFlags.length !== hFlags.length || inFlags.some((f, i) => f.id !== hFlags[i]?.id)) {
            histNodes[nodeId] = { ...histNodes[nodeId], flags: inFlags } as typeof histNodes[string];
            flagsChanged = true;
          }
        }
      }
      if (flagsChanged) {
        historyTreeUpdate = { historyTree: { ...state.historyTree, nodes: histNodes } };
      }
    }

    return {
      ...treeUpdate,
      ...historyTreeUpdate,
      ...(payload.notebook ? { notebook: payload.notebook } : {}),
      ...(payload.prompts ? { prompts: payload.prompts } : {}),
      ...(payload.artifacts ? { artifacts: payload.artifacts } : {}),
      scrollTrigger: state.scrollTrigger + 1,
    };
  }),

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
      const histNode = state.historyTree?.nodes?.[flag.nodeId];
      if (!node && !histNode) return state;
      const update: Partial<ArenaState> = {};
      if (node) {
        const updatedNode = { ...node, flags: [...node.flags, flag] };
        update.tree = {
          ...state.tree,
          nodes: { ...state.tree.nodes, [flag.nodeId]: updatedNode },
        };
      }
      if (histNode) {
        update.historyTree = {
          ...state.historyTree!,
          nodes: {
            ...state.historyTree!.nodes,
            [flag.nodeId]: { ...histNode, flags: [...(histNode.flags || []), flag] },
          },
        };
      }
      return update;
    }),

  removeFlag: (flagId) =>
    set((state) => {
      const update: Partial<ArenaState> = {};
      // Remove from tree
      const newNodes = { ...state.tree.nodes };
      for (const [nodeId, node] of Object.entries(newNodes)) {
        if (node.flags.some((f) => f.id === flagId)) {
          newNodes[nodeId] = { ...node, flags: node.flags.filter((f) => f.id !== flagId) };
          break;
        }
      }
      update.tree = { ...state.tree, nodes: newNodes };
      // Remove from historyTree
      if (state.historyTree) {
        const histNodes = { ...state.historyTree.nodes };
        for (const [nodeId, node] of Object.entries(histNodes)) {
          if (node.flags?.some((f) => f.id === flagId)) {
            histNodes[nodeId] = { ...node, flags: node.flags.filter((f) => f.id !== flagId) };
            update.historyTree = { ...state.historyTree, nodes: histNodes };
            break;
          }
        }
      }
      return update;
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

    // Hosted application panels
    panels: [],
    activePanelId: null,
    addPanel: (panel) => set((s) => {
      if (s.panels.some((p) => p.id === panel.id)) return { activePanelId: panel.id };
      return { panels: [...s.panels, panel], activePanelId: panel.id };
    }),
    removePanel: (panelId) => set((s) => ({
      panels: s.panels.filter((p) => p.id !== panelId),
      activePanelId: s.activePanelId === panelId ? (s.panels.length > 1 ? s.panels.find((p) => p.id !== panelId)?.id ?? null : null) : s.activePanelId,
    })),
    setActivePanel: (panelId) => set({ activePanelId: panelId }),

    // Agent panel control
    agentPanels: {},
    setAgentPanelClaimed: (panelId, agent) => set((s) => ({
      agentPanels: { ...s.agentPanels, [panelId]: { agent, status: "Connected" } },
    })),
    setAgentPanelReleased: (panelId) => set((s) => {
      const next = { ...s.agentPanels };
      delete next[panelId];
      return { agentPanels: next };
    }),
    setAgentPanelStatus: (panelId, status) => set((s) => {
      const existing = s.agentPanels[panelId];
      if (!existing) return s;
      return { agentPanels: { ...s.agentPanels, [panelId]: { ...existing, status } } };
    }),

    // Corrections
    corrections: [],
    editingCorrectionNodeId: null,
    setCorrections: (corrections) => set({ corrections }),
    addCorrection: (correction) => set((s) => ({
      corrections: [...s.corrections, correction],
    })),
    updateCorrection: (correction) => set((s) => ({
      corrections: s.corrections.map((c) => c.id === correction.id ? correction : c),
    })),
    removeCorrection: (correctionId) => set((s) => ({
      corrections: s.corrections.filter((c) => c.id !== correctionId),
    })),
    setEditingCorrectionNodeId: (nodeId) => set({ editingCorrectionNodeId: nodeId }),
    getCorrectionsForNode: (nodeId) => get().corrections.filter((c) => c.nodeId === nodeId),
}))
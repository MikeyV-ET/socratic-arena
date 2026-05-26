import type React from "react";
import { create } from "zustand";
import type {
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

const emptyNotebook: Notebook = { entries: [] };

interface ArenaState {
  // Core data — flat ordered message list (replaces ConversationTree)
  messages: ConversationNode[];
  _msgIndex: Map<string, ConversationNode>;
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

  // Tree windowing (legacy — kept for compat, mostly no-ops)
  expandedBranches: Set<string>;
  toggleBranch: (branchId: string) => void;
  requestTreeWindow: (centerNodeId: string) => void;

  // Workbench panels (right pane) — instance-based
  workbenchPanels: { instanceId: string; type: string; label: string; config: Record<string, any> }[];
  activeTab: string;       // instanceId of active panel
  splitTab: string | null; // instanceId of split panel
  setActiveTab: (instanceId: string) => void;
  setSplitTab: (instanceId: string | null) => void;
  closeTab: (instanceId: string) => void;
  openTab: (typeOrInstanceId: string, target?: "main" | "split") => void;
  addPanel: (type: string, config?: Record<string, any>, target?: "main" | "split") => string;
  reorderTabs: (instanceIds: string[]) => void;
  updatePanelConfig: (instanceId: string, config: Record<string, any>) => void;
  updatePanelLabel: (instanceId: string, label: string) => void;

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
  chatSide: "left" | "right";
  toggleChatSide: () => void;

  // Agent
  currentAgent: string;
  historyAgent: string;
  notebookAgent: string;
  momentsAgent: string;
  agents: { name: string; hasNotebook: boolean; hasSession: boolean; healthStatus: string | null }[];
  historyMessages: ConversationNode[];
  historyCursor: number;
  historyTotalNodes: number;
  historyLoading: boolean;

  // Live pane history
  liveCursor: number;
  liveTotalNodes: number;
  liveHistoryLoading: boolean;
  setCurrentAgent: (agent: string) => void;
  setHistoryAgent: (agent: string) => void;
  setNotebookAgent: (agent: string) => void;
  setMomentsAgent: (agent: string) => void;
  setAgents: (agents: ArenaState["agents"]) => void;
  setHistoryMessages: (messages: ConversationNode[]) => void;
  setHistoryMeta: (cursor: number, totalNodes: number) => void;
  prependHistoryMessages: (messages: ConversationNode[], newCursor: number) => void;
  setHistoryLoading: (loading: boolean) => void;
  getHistoryBranchNodes: () => ConversationNode[];

  // Live pane history actions
  setLiveMeta: (cursor: number, totalNodes: number) => void;
  setLiveHistoryLoading: (loading: boolean) => void;
  initLiveHistory: (messages: ConversationNode[], cursor: number, totalNodes: number) => void;
  prependLiveMessages: (olderMessages: ConversationNode[], newCursor: number) => void;

  // Connection
  connected: boolean;

  // Layout control (agent can resize panels)
  panelRefs: Record<string, React.RefObject<{ resize: (size: number) => void } | null>> | null;
  setPanelRefs: (refs: Record<string, React.RefObject<{ resize: (size: number) => void } | null>>) => void;
  resizePanel: (name: string, size: number) => void;

  // Derived helpers
  getActiveBranchNodes: () => ConversationNode[];
  getNodeById: (nodeId: string) => ConversationNode | undefined;

  // Actions
  setMessages: (messages: ConversationNode[]) => void;
  setNotebook: (notebook: Notebook) => void;
  setPrompts: (prompts: TrainingPrompt[]) => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  applySnapshot: (payload: { messages?: ConversationNode[]; notebook?: Notebook; prompts?: TrainingPrompt[]; artifacts?: Artifact[] }) => void;
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
  updateFlagNote: (flagId: string, note: string | undefined) => void;
  selectPrompt: (promptId: string | null) => void;
  updatePrompt: (promptId: string, fields: Partial<TrainingPrompt>) => void;
  setConnected: (connected: boolean) => void;
  sendWs: ((msg: ClientMessage) => void) | null;
  setSendWs: (fn: (msg: ClientMessage) => void) => void;
  appendStreamChunk: (nodeId: string, content: string) => void;
  appendThinkingChunk: (nodeId: string, content: string) => void;
  finalizeStream: (nodeId: string) => void;
  addLiveNode: (node: ConversationNode) => void;
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
  addAppPanel: (panel: PanelInfo) => void;
  removeAppPanel: (panelId: string) => void;
  setActiveAppPanel: (panelId: string | null) => void;

  // Agent panel control state
  agentPanels: Record<string, { agent: string; status: string }>;
  setAgentPanelClaimed: (panelId: string, agent: string) => void;
  setAgentPanelReleased: (panelId: string) => void;
  setAgentPanelStatus: (panelId: string, status: string) => void;

  // Panel chat messages (per-panel message lists for workbench chat panels)
  panelMessages: Record<string, ConversationNode[]>;
  addPanelMessage: (panelId: string, node: ConversationNode) => void;
  updatePanelMessage: (panelId: string, nodeId: string, content: string, thinking?: string | null) => void;
  setPanelAwaitingResponse: (panelId: string, v: boolean) => void;
  panelAwaitingResponse: Record<string, boolean>;

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

function buildIndex(messages: ConversationNode[]): Map<string, ConversationNode> {
  const map = new Map<string, ConversationNode>();
  for (const m of messages) map.set(m.id, m);
  return map;
}

export const useArenaStore = create<ArenaState>((set, get) => ({
  // Start empty — WebSocket state.snapshot populates on connect
  messages: [],
  _msgIndex: new Map(),
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
  // --- Instance-based workbench panels ---
  workbenchPanels: (() => {
    const toLabel = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    const defaultTypes = ["notebook"];
    try {
      const saved = localStorage.getItem("sa-workbench-panels");
      if (saved) {
        // Filter out stale "apps" singleton — replaced by per-instance "app" panels
        const panels = JSON.parse(saved).filter((p: any) => p.type !== "apps");
        if (panels.length > 0) return panels;
      }
      const savedOld = localStorage.getItem("sa-open-tabs");
      if (savedOld) {
        const ids: string[] = JSON.parse(savedOld);
        return ids.filter((id) => id !== "apps").map((id) => ({ instanceId: id, type: id, label: toLabel(id), config: {} }));
      }
    } catch {}
    return defaultTypes.map((t) => ({ instanceId: t, type: t, label: toLabel(t), config: {} }));
  })(),
  activeTab: "history",
  splitTab: null,

  addPanel: (type, config = {}, target) => {
    const state = get();
    // Always create a new instance — use openTab() to activate an existing singleton
    const instanceId = `${type}-${Math.random().toString(36).slice(2, 8)}`;
    const typeLabel = type.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    const count = state.workbenchPanels.filter((p) => p.type === type).length;
    const label = count > 0 ? `${typeLabel} ${count + 1}` : typeLabel;
    const panel = { instanceId, type, label, config };
    const next = [...state.workbenchPanels, panel];
    localStorage.setItem("sa-workbench-panels", JSON.stringify(next));
    const tabKey = target === "split" ? "splitTab" : "activeTab";
    set({ workbenchPanels: next, [tabKey]: instanceId });
    return instanceId;
  },
  setActiveTab: (instanceId) => {
    set({ activeTab: instanceId });
    const panel = get().workbenchPanels.find((p) => p.instanceId === instanceId);
    get().sendWs?.({ type: "viewport.tab_change", payload: { tab: panel?.type ?? instanceId } });
  },
  setSplitTab: (tab) => set({ splitTab: tab }),
  closeTab: (instanceId) => set((s) => {
    const next = s.workbenchPanels.filter((p) => p.instanceId !== instanceId);
    if (next.length === 0) return s;
    localStorage.setItem("sa-workbench-panels", JSON.stringify(next));
    const updates: Partial<ArenaState> = { workbenchPanels: next };
    if (s.activeTab === instanceId) updates.activeTab = next[0].instanceId;
    if (s.splitTab === instanceId) updates.splitTab = null;
    return updates as any;
  }),
  openTab: (typeOrId, target) => {
    const s = get();
    const tabKey = target === "split" ? "splitTab" : "activeTab";
    // If an instance with this ID exists, just activate it
    const byId = s.workbenchPanels.find((p) => p.instanceId === typeOrId);
    if (byId) { set({ [tabKey]: typeOrId }); return; }
    // If it's a type name and a singleton exists, activate that
    const byType = s.workbenchPanels.find((p) => p.type === typeOrId);
    if (byType) { set({ [tabKey]: byType.instanceId }); return; }
    // Otherwise create it as a singleton-style panel
    const label = typeOrId.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    const panel = { instanceId: typeOrId, type: typeOrId, label, config: {} };
    const next = [...s.workbenchPanels, panel];
    localStorage.setItem("sa-workbench-panels", JSON.stringify(next));
    set({ workbenchPanels: next, [tabKey]: typeOrId });
  },
  reorderTabs: (instanceIds) => {
    const s = get();
    const ordered = instanceIds.map((id) => s.workbenchPanels.find((p) => p.instanceId === id)).filter(Boolean) as typeof s.workbenchPanels;
    localStorage.setItem("sa-workbench-panels", JSON.stringify(ordered));
    set({ workbenchPanels: ordered });
  },
  updatePanelConfig: (instanceId, config) => set((s) => {
    const panels = s.workbenchPanels.map((p) =>
      p.instanceId === instanceId ? { ...p, config: { ...p.config, ...config } } : p
    );
    localStorage.setItem("sa-workbench-panels", JSON.stringify(panels));
    return { workbenchPanels: panels };
  }),
  updatePanelLabel: (instanceId, label) => set((s) => {
    const panels = s.workbenchPanels.map((p) =>
      p.instanceId === instanceId ? { ...p, label } : p
    );
    localStorage.setItem("sa-workbench-panels", JSON.stringify(panels));
    return { workbenchPanels: panels };
  }),

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
  historyMessages: [],
  historyCursor: 0,
  historyTotalNodes: 0,
  historyLoading: false,
  liveCursor: 0,
  liveTotalNodes: 0,
  liveHistoryLoading: false,
  setCurrentAgent: (agent) => set({ currentAgent: agent, historyAgent: agent, notebookAgent: agent, momentsAgent: agent, historyMessages: [], historyCursor: 0, historyTotalNodes: 0, liveCursor: 0, liveTotalNodes: 0 }),
  setHistoryAgent: (agent) => set({ historyAgent: agent }),
  setNotebookAgent: (agent) => set({ notebookAgent: agent }),
  setMomentsAgent: (agent) => set({ momentsAgent: agent }),
  setAgents: (agents) => set({ agents }),
  setHistoryMessages: (messages) => set({ historyMessages: messages }),
  setHistoryMeta: (cursor, totalNodes) => set({ historyCursor: cursor, historyTotalNodes: totalNodes }),
  setHistoryLoading: (loading) => set({ historyLoading: loading }),
  setLiveMeta: (cursor, totalNodes) => set({ liveCursor: cursor, liveTotalNodes: totalNodes }),
  setLiveHistoryLoading: (loading) => set({ liveHistoryLoading: loading }),
  initLiveHistory: (historyMessages, cursor, totalNodes) => set((state) => {
    // Prepend history messages before current live messages, deduplicating by ID
    const existingIds = new Set(state.messages.map((m) => m.id));
    const newMsgs = historyMessages.filter((m) => !existingIds.has(m.id));
    const merged = [...newMsgs, ...state.messages];
    return {
      messages: merged,
      _msgIndex: buildIndex(merged),
      liveCursor: cursor,
      liveTotalNodes: totalNodes,
    };
  }),
  prependLiveMessages: (olderMessages, newCursor) => set((state) => {
    const existingIds = new Set(state.messages.map((m) => m.id));
    const newMsgs = olderMessages.filter((m) => !existingIds.has(m.id));
    const merged = [...newMsgs, ...state.messages];
    return {
      messages: merged,
      _msgIndex: buildIndex(merged),
      liveCursor: newCursor,
    };
  }),
  prependHistoryMessages: (olderMessages, newCursor) => set((state) => {
    const existingIds = new Set(state.historyMessages.map((m) => m.id));
    const newMsgs = olderMessages.filter((m) => !existingIds.has(m.id));
    return {
      historyMessages: [...newMsgs, ...state.historyMessages],
      historyCursor: newCursor,
    };
  }),

  getHistoryBranchNodes: () => {
    return get().historyMessages;
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
  chatSide: (localStorage.getItem("arena-chat-side") as "left" | "right") || "left",
  toggleChatSide: () =>
    set((state) => {
      const next = state.chatSide === "left" ? "right" : "left";
      localStorage.setItem("arena-chat-side", next);
      return { chatSide: next };
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

  toggleBranch: () => { /* no-op in flat model */ },
  requestTreeWindow: () => { /* no-op in flat model */ },
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
    return get().messages;
  },

  getNodeById: (nodeId: string) => {
    return get()._msgIndex.get(nodeId);
  },

  setMessages: (messages) => set({ messages, _msgIndex: buildIndex(messages) }),
  setNotebook: (notebook) => set({ notebook }),
  setPrompts: (prompts) => set({ prompts }),
  setArtifacts: (artifacts) => set({ artifacts }),
  applySnapshot: (payload) => set((state) => {
    let msgUpdate: Record<string, unknown> = {};
    if (payload.messages) {
      // Merge: preserve client-side history messages that aren't in the snapshot.
      // The backend snapshot only has the recent tail; initLiveHistory added older messages.
      const incomingIds = new Set(payload.messages.map((m) => m.id));
      const preserved = state.messages.filter((m) => !incomingIds.has(m.id));
      const merged = [...preserved, ...payload.messages];
      msgUpdate = { messages: merged, _msgIndex: buildIndex(merged) };
    }

    // Propagate flag changes to history messages
    if (payload.messages && state.historyMessages.length > 0) {
      const incomingById = new Map(payload.messages.map((m) => [m.id, m]));
      let flagsChanged = false;
      const updatedHistory = state.historyMessages.map((hm) => {
        const incoming = incomingById.get(hm.id);
        if (incoming) {
          const inFlags = incoming.flags || [];
          const hFlags = hm.flags || [];
          if (inFlags.length !== hFlags.length || inFlags.some((f, i) => f.id !== hFlags[i]?.id)) {
            flagsChanged = true;
            return { ...hm, flags: inFlags };
          }
        }
        return hm;
      });
      if (flagsChanged) {
        msgUpdate.historyMessages = updatedHistory;
      }
    }

    return {
      ...msgUpdate,
      ...(payload.notebook ? { notebook: payload.notebook } : {}),
      ...(payload.prompts ? { prompts: payload.prompts } : {}),
      ...(payload.artifacts ? { artifacts: payload.artifacts } : {}),
      scrollTrigger: state.scrollTrigger + 1,
    };
  }),

  switchBranch: (_branchId) => {
    // No-op in flat model
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  scrollToNode: (nodeId) => {
    set({
      selectedNodeId: nodeId,
      scrollTargetId: nodeId,
    });
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
      const messages = state.messages.map((m) =>
        m.id === flag.nodeId ? { ...m, flags: [...m.flags, flag] } : m
      );
      const historyMessages = state.historyMessages.map((m) =>
        m.id === flag.nodeId ? { ...m, flags: [...(m.flags || []), flag] } : m
      );
      return { messages, _msgIndex: buildIndex(messages), historyMessages };
    }),

  removeFlag: (flagId) =>
    set((state) => {
      const messages = state.messages.map((m) =>
        m.flags.some((f) => f.id === flagId)
          ? { ...m, flags: m.flags.filter((f) => f.id !== flagId) }
          : m
      );
      const historyMessages = state.historyMessages.map((m) =>
        m.flags?.some((f) => f.id === flagId)
          ? { ...m, flags: m.flags.filter((f) => f.id !== flagId) }
          : m
      );
      return { messages, _msgIndex: buildIndex(messages), historyMessages };
    }),

  updateFlagNote: (flagId, note) =>
    set((state) => {
      const patchFlags = (flags: Flag[]) =>
        flags.map((f) => (f.id === flagId ? { ...f, note } : f));
      const messages = state.messages.map((m) =>
        m.flags.some((f) => f.id === flagId)
          ? { ...m, flags: patchFlags(m.flags) }
          : m
      );
      const historyMessages = state.historyMessages.map((m) =>
        m.flags?.some((f) => f.id === flagId)
          ? { ...m, flags: patchFlags(m.flags) }
          : m
      );
      return { messages, _msgIndex: buildIndex(messages), historyMessages };
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
      const node = state._msgIndex.get(nodeId);
      if (!node) return { streamingNodeId: null, streamingContent: "", streamingThinking: "" };
      const messages = state.messages.map((m) =>
        m.id === nodeId
          ? { ...m, content: state.streamingContent || m.content, thinking: state.streamingThinking || m.thinking }
          : m
      );
      return {
        messages,
        _msgIndex: buildIndex(messages),
        streamingNodeId: null,
        streamingContent: "",
        streamingThinking: "",
      };
    }),

  addLiveNode: (node) =>
    set((state) => {
      // Skip duplicates
      if (state._msgIndex.has(node.id)) return state;
      const messages = [...state.messages, node];
      const idx = new Map(state._msgIndex);
      idx.set(node.id, node);
      return { messages, _msgIndex: idx };
    }),

  updateLiveNode: (nodeId, content, thinking) =>
    set((state) => {
      if (!state._msgIndex.has(nodeId)) return state;
      const messages = state.messages.map((m) =>
        m.id === nodeId
          ? { ...m, content, ...(thinking != null ? { thinking } : {}) }
          : m
      );
      return { messages, _msgIndex: buildIndex(messages) };
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
    addAppPanel: (panel) => set((s) => {
      if (s.panels.some((p) => p.id === panel.id)) return { activePanelId: panel.id };
      return { panels: [...s.panels, panel], activePanelId: panel.id };
    }),
    removeAppPanel: (panelId) => set((s) => ({
      panels: s.panels.filter((p) => p.id !== panelId),
      activePanelId: s.activePanelId === panelId ? (s.panels.length > 1 ? s.panels.find((p) => p.id !== panelId)?.id ?? null : null) : s.activePanelId,
    })),
    setActiveAppPanel: (panelId) => set({ activePanelId: panelId }),

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

    // Panel chat messages
    panelMessages: {},
    panelAwaitingResponse: {},
    addPanelMessage: (panelId, node) => set((s) => {
      const existing = s.panelMessages[panelId] || [];
      if (existing.some((m) => m.id === node.id)) return s;
      return { panelMessages: { ...s.panelMessages, [panelId]: [...existing, node] } };
    }),
    updatePanelMessage: (panelId, nodeId, content, thinking) => set((s) => {
      const existing = s.panelMessages[panelId];
      if (!existing) return s;
      return {
        panelMessages: {
          ...s.panelMessages,
          [panelId]: existing.map((m) =>
            m.id === nodeId ? { ...m, content, ...(thinking != null ? { thinking } : {}) } : m
          ),
        },
      };
    }),
    setPanelAwaitingResponse: (panelId, v) => set((s) => ({
      panelAwaitingResponse: { ...s.panelAwaitingResponse, [panelId]: v },
    })),

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
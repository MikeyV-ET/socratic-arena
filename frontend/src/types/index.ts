// Data shapes from DESIGN.md §1

export interface ToolCallSummary {
  toolCallId: string;
  title: string;
  status: "pending" | "completed" | "error";
}

export interface Flag {
  id: string;
  nodeId: string;
  type: "training_candidate";
  note?: string;
  createdAt: number;
}

export interface ConversationNode {
  id: string;
  parentId: string | null;
  branchId: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  timestamp: number;
  eventId: string;
  children: string[];
  flags: Flag[];
  metadata?: {
    modelId?: string;
    totalTokens?: number;
    toolCalls?: ToolCallSummary[];
  };
  agentLabel?: string;
}

export interface Branch {
  id: string;
  parentNodeId: string;
  rootNodeId: string;
  sessionId: string;
  label?: string;
  createdAt: number;
}

export interface CollapsedBranch {
  branchId: string;
  parentNodeId: string;
  nodeCount: number;
  flagCount: number;
  timeRange: [number, number];
  label?: string;
}

export interface TreeStats {
  totalNodes: number;
  totalBranches: number;
  totalFlags: number;
  timeRange: [number, number];
}

export interface ConversationTree {
  id: string;
  branches: Record<string, Branch>;
  nodes: Record<string, ConversationNode>;
  rootNodeId: string;
  activeBranchId: string;
  activeNodeId: string;
  collapsedBranches?: CollapsedBranch[];
  stats?: TreeStats;
}

export interface NotebookEntry {
  id: string;
  branchId: string;
  eventIdRange: [string, string];
  timestamp: number;
  title: string;
  content: string;
  tags?: string[];
  flags?: Flag[];
}

export interface Notebook {
  entries: NotebookEntry[];
}

export interface PromptTestResult {
  id: string;
  completion: string;
  caught: boolean;
  reward: number;
  model: string;
  label?: string;
}

export interface PromptTestRun {
  id: string;
  promptId: string;
  model: string;
  n: number;
  results: PromptTestResult[];
  varianceScore: number;
  timestamp: number;
}

export interface PromptDevNote {
  id: string;
  author: string;
  text: string;
  timestamp: number;
}

export interface TrainingPrompt {
  id: string;
  flagId: string;
  sourceNodeId: string;
  systemPrompt: string;
  contextPrompt: string;
  probe: string;
  bridgeProbe: string;
  expectedBehavior: string;
  failureBehavior: string;
  status: "draft" | "testing" | "validated" | "rejected";
  testResults: PromptTestRun[];
  devLog: PromptDevNote[];
}

export interface Artifact {
  id: string;
  branchId: string;
  type: "presentation" | "writeup";
  filename: string;
  title: string;
  lastModified: number;
}

// WebSocket message types

export interface ClientMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface StateSnapshot {
  tree: ConversationTree;
  notebook: Notebook;
  prompts: TrainingPrompt[];
  artifacts: Artifact[];
}
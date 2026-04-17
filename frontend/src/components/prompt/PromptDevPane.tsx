import { useEffect } from "react";
import { useArenaStore } from "@/stores/arenaStore";

export function PromptDevPane() {
  const draft = useArenaStore((s) => s.promptDraft);
  const setField = useArenaStore((s) => s.setPromptDraftField);
  const prompts = useArenaStore((s) => s.prompts);
  const selectedPromptId = useArenaStore((s) => s.selectedPromptId);
  const selectPrompt = useArenaStore((s) => s.selectPrompt);
  const updatePrompt = useArenaStore((s) => s.updatePrompt);
  const populatePromptDraft = useArenaStore((s) => s.populatePromptDraft);
  const sendWs = useArenaStore((s) => s.sendWs);
  const setActiveTab = useArenaStore((s) => s.setActiveTab);
  const reportWorkbenchFocus = useArenaStore((s) => s.reportWorkbenchFocus);

  const prompt = prompts.find((p) => p.id === selectedPromptId) || prompts[prompts.length - 1];

  // Sync draft from selected prompt + report focus
  useEffect(() => {
    if (prompt) {
      populatePromptDraft({
        systemPrompt: prompt.systemPrompt,
        contextPrompt: prompt.contextPrompt,
        probe: prompt.probe,
        bridgeProbe: prompt.bridgeProbe,
        expectedBehavior: prompt.expectedBehavior,
        failureBehavior: prompt.failureBehavior,
      });
      reportWorkbenchFocus("prompt-dev", prompt.id, "prompt", prompt.contextPrompt?.slice(0, 100));
    }
  }, [prompt?.id, prompt?.systemPrompt, prompt?.contextPrompt, prompt?.probe, prompt?.bridgeProbe, prompt?.expectedBehavior, prompt?.failureBehavior]);

  const handleSave = () => {
    if (!prompt) return;
    updatePrompt(prompt.id, draft);
  };

  const handleSaveNew = () => {
    if (!sendWs) return;
    sendWs({
      type: "prompt.create",
      payload: {
        systemPrompt: draft.systemPrompt,
        contextPrompt: draft.contextPrompt,
        probe: draft.probe,
        bridgeProbe: draft.bridgeProbe,
        expectedBehavior: draft.expectedBehavior,
        failureBehavior: draft.failureBehavior,
      },
    });
  };

  const editorStyle = "w-full bg-background text-foreground text-xs font-mono p-3 rounded border border-border resize-y focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed";

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Prompt Editor
          </h2>
          {prompt && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              prompt.status === "validated" ? "bg-success/20 text-success"
                : prompt.status === "rejected" ? "bg-destructive/20 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}>
              {prompt.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {prompts.length > 1 && (
            <select
              value={prompt?.id || ""}
              onChange={(e) => selectPrompt(e.target.value)}
              className="text-[10px] bg-muted text-foreground px-1.5 py-0.5 rounded border border-border"
            >
              {prompts.map((p, i) => (
                <option key={p.id} value={p.id}>Prompt {i + 1}</option>
              ))}
            </select>
          )}
          {prompt && (
            <>
              <button onClick={handleSave} className="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Save
              </button>
              <button onClick={handleSaveNew} className="text-[10px] px-2 py-1 rounded bg-muted text-foreground hover:bg-muted/70 transition-colors">
                Save as New
              </button>
              <button onClick={() => { selectPrompt(prompt.id); setActiveTab("prompt-test"); }} className="text-[10px] px-2 py-1 rounded bg-success/20 text-success hover:bg-success/30 transition-colors">
                Test
              </button>
            </>
          )}
          {!prompt && (
            <button onClick={handleSaveNew} className="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Create
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">System</div>
          <textarea
            value={draft.systemPrompt}
            onChange={(e) => setField("systemPrompt", e.target.value)}
            className={editorStyle}
            rows={4}
            placeholder="System prompt -- set the context and role..."
          />
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Context (Prompt A)</div>
          <textarea
            value={draft.contextPrompt ?? ""}
            onChange={(e) => setField("contextPrompt", e.target.value)}
            className={editorStyle}
            rows={6}
            placeholder="Everything that brings the model to the failure point. Should reproduce the gap without the probe."
          />
        </div>
        <div>
          <div className="text-[10px] text-warning uppercase tracking-wider mb-1">Probe (A + Probe = Prompt B)</div>
          <textarea
            value={draft.probe ?? ""}
            onChange={(e) => setField("probe", e.target.value)}
            className={`${editorStyle} border-warning/30 focus:ring-warning`}
            rows={3}
            placeholder="The Socratic question that activates the capability. No new information -- just the trigger."
          />
        </div>
        <div>
          <div className="text-[10px] text-cyan-400 uppercase tracking-wider mb-1">Bridge Probe (A + Bridge = Prompt C)</div>
          <textarea
            value={draft.bridgeProbe ?? ""}
            onChange={(e) => setField("bridgeProbe", e.target.value)}
            className={`${editorStyle} border-cyan-400/30 focus:ring-cyan-400`}
            rows={3}
            placeholder="Meta question — asks the model what it should ask itself. 'What should you question about this before deciding?'"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-success uppercase tracking-wider mb-1">Catches it</div>
            <textarea
              value={draft.expectedBehavior}
              onChange={(e) => setField("expectedBehavior", e.target.value)}
              className={`${editorStyle} border-success/30 focus:ring-success`}
              rows={3}
              placeholder="What does it look like when the model catches the problem?"
            />
          </div>
          <div>
            <div className="text-[10px] text-destructive uppercase tracking-wider mb-1">Misses it</div>
            <textarea
              value={draft.failureBehavior}
              onChange={(e) => setField("failureBehavior", e.target.value)}
              className={`${editorStyle} border-destructive/30 focus:ring-destructive`}
              rows={3}
              placeholder="What does it look like when the model misses it?"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

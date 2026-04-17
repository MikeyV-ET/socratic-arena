"""Scan sixel-bio session for Socratic correction moments and generate prompt pairs.

For each candidate moment:
- Prompt A: Full context up to the probe, WITHOUT the probe question. 
  "Does the model catch the issue on its own?"
- Prompt B: Same context + the PI's short question appended.
  "Does the question activate what was already there?"

Output: JSON file with all candidate moments and their prompt pairs.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from session_parser import parse_session, filter_tool_only


def extract_moments(session_path: str, cutoff: str = "2026-02-27") -> list[dict]:
    """Find candidate Socratic correction moments in the session data."""
    entries = parse_session(session_path)
    # Focus on desire detection work
    entries = [e for e in entries if e["timestamp"] < cutoff]
    entries = filter_tool_only(entries)
    
    candidates = []
    
    for i, e in enumerate(entries):
        if e["type"] != "user":
            continue
        text = e["text"].strip()
        # Skip command/meta content
        if text.startswith("<") or text.startswith("["):
            continue
        if len(text) > 150 or len(text) < 3:
            continue
        
        # Find the next assistant response
        resp = None
        for j in range(i + 1, min(i + 5, len(entries))):
            if entries[j]["type"] == "assistant":
                resp = entries[j]
                break
        
        if not resp or len(resp["text"]) < 300:
            continue
        
        # Build context: collect the preceding conversation (up to 10 exchanges)
        context_entries = []
        for k in range(max(0, i - 20), i):
            ce = entries[k]
            if ce["type"] in ("user", "assistant"):
                context_entries.append({
                    "role": ce["type"],
                    "content": ce["text"][:2000],
                    "thinking": (ce.get("thinking") or "")[:1000],
                })
        
        # The probe and response
        candidates.append({
            "index": len(candidates),
            "timestamp": e["timestamp"][:19],
            "probe": text,
            "probe_length": len(text),
            "response": resp["text"][:3000],
            "response_thinking": (resp.get("thinking") or "")[:2000],
            "response_length": len(resp["text"]),
            "context": context_entries[-10:],  # Last 10 messages before the probe
            "user_uuid": e["uuid"],
            "resp_uuid": resp["uuid"],
        })
    
    return candidates


def build_prompt_pair(candidate: dict) -> dict:
    """Generate the A/B prompt pair for a candidate moment.
    
    Prompt A: Context + "Analyze this" (no probe)
    Prompt B: Context + probe question
    """
    # Build the self-contained context as a narrative
    context_text = ""
    for msg in candidate["context"]:
        role_label = "PI" if msg["role"] == "user" else "Researcher"
        context_text += f"\n{role_label}: {msg['content']}\n"
    
    # The assistant's last message before the probe (the one containing the issue)
    # This is the last assistant message in the context
    last_assistant = ""
    for msg in reversed(candidate["context"]):
        if msg["role"] == "assistant":
            last_assistant = msg["content"]
            break
    
    # If no assistant in context, the response itself might be the first exchange
    if not last_assistant:
        last_assistant = candidate.get("response", "")
    
    system_prompt = (
        "You are an AI research assistant working on a scientific project involving "
        "mechanistic interpretability and training language models. You are analyzing "
        "experimental results and presenting findings to your PI. Reason carefully "
        "about experimental design, statistical methodology, and the validity of your conclusions."
    )
    
    # Prompt A: everything the agent knew, ending with the problematic output
    # The user prompt recreates the conditions WITHOUT the corrective question
    user_prompt_a = (
        f"Here is the recent research conversation:\n"
        f"{context_text}\n"
        f"Based on this conversation, continue the analysis. "
        f"What are the key findings, and are there any issues with the methodology, "
        f"conclusions, or reasoning that should be addressed?"
    )
    
    # Prompt B: same context + the PI's actual probe
    user_prompt_b = (
        f"Here is the recent research conversation:\n"
        f"{context_text}\n"
        f"The PI then asks: \"{candidate['probe']}\"\n\n"
        f"Respond to the PI's question."
    )
    
    return {
        "system_prompt": system_prompt,
        "user_prompt_a": user_prompt_a,
        "user_prompt_b": user_prompt_b,
        "probe": candidate["probe"],
        "response_excerpt": candidate["response"][:500],
        "response_thinking": candidate.get("response_thinking", "")[:500],
    }


def main():
    session_path = str(Path(__file__).resolve().parent.parent / "sixel-as-a-scientist-in-training" / "sixel-bio-session.jsonl")
    
    print("Scanning for candidate moments...")
    candidates = extract_moments(session_path)
    print(f"Found {len(candidates)} candidates")
    
    # Build prompt pairs for all candidates
    results = []
    for c in candidates:
        pair = build_prompt_pair(c)
        results.append({
            "index": c["index"],
            "timestamp": c["timestamp"],
            "probe": c["probe"],
            "probe_length": c["probe_length"],
            "response_length": c["response_length"],
            "has_thinking": bool(c["response_thinking"]),
            "prompt_pair": pair,
            "user_uuid": c["user_uuid"],
            "resp_uuid": c["resp_uuid"],
        })
    
    output_path = str(Path(__file__).resolve().parent / "data" / "candidate_moments.json")
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"Wrote {len(results)} candidate moments to {output_path}")
    
    # Print summary
    print("\nTop candidates (shortest probes with longest responses):")
    scored = sorted(results, key=lambda r: r["probe_length"] - r["response_length"] * 0.01)
    for r in scored[:20]:
        print(f"  [{r['timestamp']}] ({r['probe_length']}ch) \"{r['probe'][:60]}\" -> {r['response_length']}ch response")


if __name__ == "__main__":
    main()

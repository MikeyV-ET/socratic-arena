import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import * as d3 from "d3";
import { useArenaStore } from "@/stores/arenaStore";

interface TreeNodeData {
  id: string;
  parentId: string | null;
  role: string;
  branchId: string;
  hasFlag: boolean;
  childCount: number;
  isCollapsed?: boolean;
  collapsedCount?: number;
  collapsedFlags?: number;
  collapsedLabel?: string;
}

const NODE_SPACING_Y = 40;
const MIN_BRANCH_SPACING_X = 60;
const MARGIN = { top: 20, right: 20, bottom: 20, left: 20 };
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

export function TreeView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const tree = useArenaStore((s) => s.tree);
  const selectedNodeId = useArenaStore((s) => s.selectedNodeId);
  const switchBranch = useArenaStore((s) => s.switchBranch);
  const scrollToNode = useArenaStore((s) => s.scrollToNode);
  const toggleBranch = useArenaStore((s) => s.toggleBranch);

  // Track container size with ResizeObserver
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const treeData = useMemo(() => {
    const nodes = Object.values(tree.nodes);
    const result: TreeNodeData[] = nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      role: n.role,
      branchId: n.branchId,
      hasFlag: n.flags.length > 0,
      childCount: n.children.length,
    }));

    // Add collapsed branch summary nodes
    if (tree.collapsedBranches) {
      for (const cb of tree.collapsedBranches) {
        result.push({
          id: `collapsed_${cb.branchId}`,
          parentId: cb.parentNodeId,
          role: "collapsed",
          branchId: cb.branchId,
          hasFlag: cb.flagCount > 0,
          childCount: 0,
          isCollapsed: true,
          collapsedCount: cb.nodeCount,
          collapsedFlags: cb.flagCount,
          collapsedLabel: cb.label,
        });
      }
    }

    return result;
  }, [tree.nodes, tree.collapsedBranches]);

  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const drawTree = useCallback(() => {
    if (!svgRef.current || dims.width === 0 || treeData.length === 0) return;

    const stratify = d3
      .stratify<TreeNodeData>()
      .id((d) => d.id)
      .parentId((d) => d.parentId);

    let root: d3.HierarchyNode<TreeNodeData>;
    try {
      root = stratify(treeData);
    } catch {
      return;
    }

    const depth = root.height;
    const treeWidth = Math.max(dims.width - MARGIN.left - MARGIN.right, MIN_BRANCH_SPACING_X);
    const treeHeight = Math.max(depth * NODE_SPACING_Y, 60);
    const svgHeight = treeHeight + MARGIN.top + MARGIN.bottom;

    const svg = d3
      .select(svgRef.current)
      .attr("width", dims.width)
      .attr("height", svgHeight);

    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Zoom behavior — Ctrl+wheel = zoom, plain wheel = vertical scroll
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event: Event) => {
        if (event.type === "wheel") return (event as WheelEvent).shiftKey;
        return true;
      })
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Plain wheel = vertical pan (CAD-style)
    svg.on("wheel.pan", (event: WheelEvent) => {
      if (event.shiftKey) return;
      event.preventDefault();
      const t = d3.zoomTransform(svgRef.current!);
      const next = d3.zoomIdentity.translate(t.x - event.deltaX, t.y - event.deltaY).scale(t.k);
      svg.call(zoom.transform, next);
    });

    // Restore previous transform if any, otherwise set initial
    const currentTransform = d3.zoomTransform(svgRef.current);
    if (currentTransform.k === 1 && currentTransform.x === 0 && currentTransform.y === 0) {
      svg.call(zoom.transform, d3.zoomIdentity.translate(MARGIN.left, MARGIN.top));
    }

    const treeLayout = d3
      .tree<TreeNodeData>()
      .size([treeWidth, treeHeight]);

    treeLayout(root);

    const colorForBranch = (branchId: string) =>
      branchId === tree.activeBranchId ? "#2a5a8a" : "#6b7a8d";

    // Links
    g.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", (d) => colorForBranch(d.target.data.branchId))
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5)
      .attr(
        "d",
        d3
          .linkVertical<d3.HierarchyLink<TreeNodeData>, d3.HierarchyPointNode<TreeNodeData>>()
          .x((d) => d.x!)
          .y((d) => d.y!) as never
      );

    // Nodes
    const tooltip = tooltipRef.current;
    const node = g
      .selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        if (d.data.isCollapsed) {
          toggleBranch(d.data.branchId);
          return;
        }
        if (d.data.branchId !== tree.activeBranchId) {
          switchBranch(d.data.branchId);
        }
        scrollToNode(d.data.id);
      })
      .on("mouseenter", (event, d) => {
        if (!tooltip) return;
        let text: string;
        if (d.data.isCollapsed) {
          const flags = d.data.collapsedFlags ? `, ${d.data.collapsedFlags} flagged` : "";
          text = `${d.data.collapsedLabel || d.data.branchId}: ${d.data.collapsedCount} nodes${flags} (click to expand)`;
        } else {
          const nodeData = tree.nodes[d.data.id];
          if (!nodeData) return;
          const roleLabel = d.data.role === "user" ? "Eric" : d.data.role === "assistant" ? (nodeData.agentLabel || "Agent") : "system";
          const preview = nodeData.content.slice(0, 80) + (nodeData.content.length > 80 ? "..." : "");
          text = `${roleLabel}: ${preview}`;
        }
        tooltip.textContent = text;
        tooltip.style.display = "block";
        const rect = (event.target as SVGElement).closest("svg")!.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top - 8}px`;
      })
      .on("mousemove", (event) => {
        if (!tooltip) return;
        const rect = (event.target as SVGElement).closest("svg")!.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top - 8}px`;
      })
      .on("mouseleave", () => {
        if (tooltip) tooltip.style.display = "none";
      });

    // Collapsed branch nodes — diamond shape with count
    node
      .filter((d) => d.data.isCollapsed === true)
      .append("rect")
      .attr("x", -8)
      .attr("y", -8)
      .attr("width", 16)
      .attr("height", 16)
      .attr("transform", "rotate(45)")
      .attr("fill", (d) => d.data.collapsedFlags ? "#c4943a" : "#4a5568")
      .attr("stroke", "#2a5a8a")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.8);

    node
      .filter((d) => d.data.isCollapsed === true)
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "#e2e8f0")
      .attr("font-size", "8px")
      .attr("font-weight", "bold")
      .attr("pointer-events", "none")
      .text((d) => d.data.collapsedCount ? `${d.data.collapsedCount}` : "");

    // Regular nodes — circles
    node
      .filter((d) => !d.data.isCollapsed)
      .append("circle")
      .attr("r", (d) => {
        if (d.data.hasFlag) return 6;
        if (d.data.childCount > 1) return 5;
        return 3.5;
      })
      .attr("fill", (d) => {
        if (d.data.hasFlag) return "#c4943a";
        if (d.data.role === "user") return colorForBranch(d.data.branchId);
        if (d.data.role === "assistant") return "#3a8a6e";
        return "#6b7a8d";
      })
      .attr("stroke", (d) =>
        d.data.branchId === tree.activeBranchId ? "#2a5a8a" : "none"
      )
      .attr("stroke-width", 1.5);

    // Selected node highlight (regular nodes only)
    node
      .filter((d) => !d.data.isCollapsed && d.data.id === selectedNodeId)
      .append("circle")
      .attr("r", 10)
      .attr("fill", "none")
      .attr("stroke", "#c4943a")
      .attr("stroke-width", 2)
      .attr("opacity", 0.8);

    // Branch fork indicators
    node
      .filter((d) => d.data.childCount > 1)
      .append("circle")
      .attr("r", 8)
      .attr("fill", "none")
      .attr("stroke", "#2a5a8a")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2")
      .attr("opacity", 0.5);

  }, [treeData, tree.activeBranchId, tree.nodes, tree.branches, selectedNodeId, switchBranch, scrollToNode, toggleBranch, dims]);

  useEffect(() => {
    drawTree();
  }, [drawTree]);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(200).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const handleZoomReset = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(MARGIN.left, MARGIN.top)
    );
  }, []);

  return (
    <div className="h-full bg-card border-r border-border flex flex-col">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tree
          </h2>
          {tree.stats && (
            <span className="text-[9px] text-muted-foreground/60">
              {tree.stats.totalNodes.toLocaleString()} nodes · {tree.stats.totalBranches} branches{tree.stats.totalFlags > 0 ? ` · ${tree.stats.totalFlags} flags` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
            title="Zoom out"
          >
            &minus;
          </button>
          <button
            onClick={handleZoomReset}
            className="px-1.5 h-5 flex items-center justify-center rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Reset zoom"
          >
            fit
          </button>
          <button
            onClick={handleZoomIn}
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div ref={wrapperRef} className="flex-1 overflow-hidden relative">
        <svg ref={svgRef} />
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none px-2 py-1 rounded bg-popover text-popover-foreground text-[10px] border border-border shadow-md max-w-[200px] whitespace-pre-wrap z-10"
          style={{ display: "none" }}
        />
      </div>
      <div className="px-3 py-1.5 border-t border-border flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-accent" />
          user
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-success" />
          agent
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-warning" />
          flagged
        </span>
      </div>
    </div>
  );
}
"""Render Markdown slide content into a reveal.js HTML presentation.

The agent writes slides in Markdown using --- as slide separators.
This module wraps that content in a reveal.js template with Mermaid
and KaTeX support.
"""

REVEAL_TEMPLATE = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  :root {{ --r-background-color: #0b1120; --r-main-color: #e2e8f0; --r-heading-color: #c4943a; }}
  .reveal {{ font-family: 'Inter', system-ui, sans-serif; font-size: 28px; }}
  .reveal h1, .reveal h2, .reveal h3 {{ color: var(--r-heading-color); font-weight: 600; }}
  .reveal h1 {{ font-size: 2em; }}
  .reveal h2 {{ font-size: 1.4em; }}
  .reveal code {{ color: #c4943a; background: rgba(196,148,58,0.1); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }}
  .reveal pre code {{ display: block; padding: 0.8em; background: #1e293b; border-radius: 6px; text-align: left; font-size: 0.7em; }}
  .reveal blockquote {{ background: rgba(196,148,58,0.15); border-left: 3px solid #c4943a; padding: 0.5em 1em; margin: 0.5em 0; text-align: left; font-style: normal; }}
  .reveal table {{ font-size: 0.8em; margin: 0 auto; }}
  .reveal th {{ color: #c4943a; border-bottom: 1px solid #334155; }}
  .reveal td, .reveal th {{ padding: 0.3em 0.8em; }}
  .reveal img {{ max-height: 60vh; }}
  .reveal .mermaid {{ background: transparent; }}
  .reveal .mermaid svg {{ max-height: 55vh; }}
  .reveal .slides section {{ overflow-y: auto !important; max-height: 100vh; }}
  .reveal .slides section::-webkit-scrollbar {{ width: 4px; }}
  .reveal .slides section::-webkit-scrollbar-thumb {{ background: rgba(255,255,255,0.2); border-radius: 2px; }}
</style>
</head>
<body>
<div class="reveal">
<div class="slides">
{slides_html}
</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/markdown/markdown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/highlight.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/math/math.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({{ startOnLoad: false, theme: 'dark' }});

Reveal.initialize({{
  hash: true,
  transition: 'fade',
  backgroundTransition: 'fade',
  controlsTutorial: false,
  progress: true,
  center: true,
  scrollActivationWidth: null,
  plugins: [ RevealMarkdown, RevealHighlight, RevealMath.KaTeX ],
}}).then(() => {{
  // Render mermaid diagrams after reveal loads
  document.querySelectorAll('.mermaid').forEach((el, i) => {{
    mermaid.render('mermaid-' + i, el.textContent).then(({{svg}}) => {{
      el.innerHTML = svg;
    }});
  }});
}});

// Handle messages from parent frame (reload, zoom)
window.addEventListener('message', (e) => {{
  if (e.data === 'reload') location.reload();
  if (e.data && e.data.type === 'zoom') {{
    const scale = e.data.scale || 1;
    document.querySelector('.reveal').style.fontSize = (28 * scale) + 'px';
  }}
}});
</script>
</body>
</html>"""


def render_markdown_slides(markdown: str, title: str = "Presentation") -> str:
    """Convert Markdown with --- separators into reveal.js HTML.

    Each slide is a <section> with data-markdown. Mermaid code blocks
    are converted to <div class="mermaid"> for client-side rendering.
    """
    slides = markdown.split("\n---\n")
    sections = []

    for slide in slides:
        slide = slide.strip()
        if not slide:
            continue

        # Check for mermaid code blocks and handle them specially
        # Reveal's markdown plugin doesn't know about mermaid, so we
        # render mermaid slides as raw HTML sections
        if "```mermaid" in slide:
            html = _render_mermaid_slide(slide)
            sections.append(f"<section>\n{html}\n</section>")
        else:
            # Use reveal.js markdown plugin for standard slides
            escaped = slide.replace("{", "&#123;").replace("}", "&#125;")
            sections.append(
                f'<section data-markdown><textarea data-template>\n{escaped}\n</textarea></section>'
            )

    slides_html = "\n\n".join(sections)
    return REVEAL_TEMPLATE.format(title=title, slides_html=slides_html)


def _render_mermaid_slide(slide: str) -> str:
    """Convert a slide containing ```mermaid blocks into HTML."""
    import re
    parts = []
    remaining = slide

    for match in re.finditer(r"```mermaid\n(.*?)```", slide, re.DOTALL):
        before = remaining[:remaining.index(match.group(0))]
        if before.strip():
            parts.append(f'<div data-markdown><textarea data-template>\n{before.strip()}\n</textarea></div>')
        parts.append(f'<div class="mermaid">\n{match.group(1).strip()}\n</div>')
        remaining = remaining[remaining.index(match.group(0)) + len(match.group(0)):]

    if remaining.strip():
        parts.append(f'<div data-markdown><textarea data-template>\n{remaining.strip()}\n</textarea></div>')

    return "\n".join(parts)

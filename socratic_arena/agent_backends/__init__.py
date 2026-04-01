"""Agent backends for Socratic Arena.

Each backend implements the AgentBackend interface for communicating
with an LLM agent via subprocess or API.
"""

from .base import AgentBackend
from .grok_stdio import GrokStdioBackend

__all__ = ["AgentBackend", "GrokStdioBackend"]
"""Abstract base class for agent backends."""

from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional


class AgentBackend(ABC):
    """Interface for communicating with an LLM agent.

    Backends can be subprocess-based (grok stdio) or API-based (OpenAI, etc.).
    The session manager talks to this interface; it doesn't know the transport.
    """

    @abstractmethod
    async def start(
        self,
        system_prompt: str,
        workspace_path: str,
        conversation_history: list[dict] | None = None,
    ) -> None:
        """Start the agent. For subprocess backends, this spawns the process.
        For API backends, this initializes the client.

        Args:
            system_prompt: The system prompt for the agent.
            workspace_path: Working directory for the agent.
            conversation_history: Optional prior conversation to replay (for forks).
        """
        ...

    @abstractmethod
    async def send(self, message: str) -> str:
        """Send a message to the agent and get the full response.

        Args:
            message: The human's message.

        Returns:
            The agent's complete response text.
        """
        ...

    @abstractmethod
    async def send_streaming(self, message: str) -> AsyncIterator[str]:
        """Send a message and stream the response token by token.

        Args:
            message: The human's message.

        Yields:
            Chunks of the agent's response as they arrive.
        """
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop the agent. For subprocess backends, this terminates the process."""
        ...

    @abstractmethod
    def is_running(self) -> bool:
        """Check if the agent is still running."""
        ...

    @property
    @abstractmethod
    def backend_name(self) -> str:
        """Human-readable name of this backend (e.g., 'grok-stdio', 'openai')."""
        ...
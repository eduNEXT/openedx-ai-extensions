"""
XBlock service for AI Extensions.

Exposes the ``"ai_extensions"`` service so that XBlocks can make LLM calls
without importing Django models directly.

Service registration is handled via the ``openedx.xblock_service`` setuptools
entry point (see ``setup.py``).  On older edx-platform versions that lack
the entry-point mechanism, the service is registered via a controlled
monkey-patch in ``OpenedxAIExtensionsConfig.ready()``.

Usage (XBlock side)::

    @XBlock.wants("ai_extensions")
    class MyXBlock(XBlock):
        @XBlock.json_handler
        def ask(self, data, suffix=""):
            ai = self.runtime.service(self, "ai_extensions")
            if ai is None:
                return {"error": "AI service not available"}
            return ai.call_llm(prompt="You are a tutor.", user_input=data.get("question"))
"""

SERVICE_NAME = "ai_extensions"


def get_service_class():
    """Return the AIExtensionsXBlockService class.

    Imported lazily so that this module can be safely imported in settings
    files before the full Django app registry is ready.
    """
    from openedx_ai_extensions.xblock_service.service import (  # noqa: PLC0415  pylint: disable=import-outside-toplevel
        AIExtensionsXBlockService,
    )
    return AIExtensionsXBlockService


def ai_extensions_factory(runtime, block):
    """Entry-point factory for the ``openedx.xblock_service`` extension point.

    Called by edx-platform's plugin service discovery with ``(runtime, block)``.
    Delegates to :func:`~openedx_ai_extensions.xblock_service.mixin._build_service`
    which extracts user/course/location context and returns an
    :class:`~openedx_ai_extensions.xblock_service.service.AIExtensionsXBlockService`
    instance (or ``None`` on error).
    """
    from openedx_ai_extensions.xblock_service.mixin import (  # noqa: PLC0415  pylint: disable=import-outside-toplevel
        _build_service,
    )
    return _build_service(runtime, block)

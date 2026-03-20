"""
Factory callable for the ``"ai_extensions"`` XBlock service.

Registered via ``XBLOCK_EXTRA_SERVICES`` in the plugin settings so that
edx-platform's ``XBlockRuntime.service()`` can instantiate the service
without any monkey-patching.

The factory signature expected by edx-platform is::

    factory(block=<XBlock>, runtime=<XBlockRuntime>) -> service_instance
"""

import logging

from openedx_ai_extensions.xblock_service.service import AIExtensionsXBlockService

logger = logging.getLogger(__name__)


def ai_extensions_service_factory(*, block, runtime):
    """
    Build an :class:`AIExtensionsXBlockService` from the XBlock runtime context.

    Called by ``XBlockRuntime.service()`` when ``service_name`` matches an entry
    in ``settings.XBLOCK_EXTRA_SERVICES``.

    Args:
        block: The XBlock instance requesting the service.
        runtime: The ``XBlockRuntime`` instance.

    Returns:
        An ``AIExtensionsXBlockService`` instance, or ``None`` on error
        (honouring the ``@XBlock.wants`` contract).
    """
    try:
        user = _get_user(runtime)
        course_id = _get_course_id(block)
        location_id = _get_location_id(block)

        return AIExtensionsXBlockService(
            user=user,
            course_id=course_id,
            location_id=location_id,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        logger.exception(
            "openedx_ai_extensions: failed to build AIExtensionsXBlockService "
            "for block %r",
            getattr(block, "location", repr(block)),
        )
        return None


# ---------------------------------------------------------------------------
# Context extractors
# ---------------------------------------------------------------------------

def _get_user(runtime):
    """
    Return the Django ``User`` for the current request, or ``None``.

    Tries:
      1. ``runtime.user``                 — modern XBlockRuntime
      2. ``runtime.get_real_user(id)``    — legacy ModuleSystem helper
      3. ``User.objects.get(pk=...)``     — last resort DB lookup
    """
    user = getattr(runtime, "user", None)
    if user is not None:
        return user

    user_id = getattr(runtime, "user_id", None)
    if user_id is not None:
        get_real_user = getattr(runtime, "get_real_user", None)
        if callable(get_real_user):
            try:
                return get_real_user(user_id)
            except Exception:  # pylint: disable=broad-exception-caught
                pass

        try:
            from django.contrib.auth import get_user_model  # pylint: disable=import-outside-toplevel
            return get_user_model().objects.get(pk=user_id)
        except Exception:  # pylint: disable=broad-exception-caught
            pass

    return None


def _get_course_id(block):
    """Return the ``CourseKey`` for *block*, or ``None``."""
    scope_ids = getattr(block, "scope_ids", None)
    if scope_ids is not None:
        usage_id = getattr(scope_ids, "usage_id", None)
        if usage_id is not None:
            try:
                return usage_id.course_key
            except AttributeError:
                pass

    return getattr(block, "course_id", None)


def _get_location_id(block):
    """Return a string usage key for *block*, or ``None``."""
    location = getattr(block, "location", None)
    if location is not None:
        return str(location)

    scope_ids = getattr(block, "scope_ids", None)
    if scope_ids is not None:
        usage_id = getattr(scope_ids, "usage_id", None)
        if usage_id is not None:
            return str(usage_id)

    return None

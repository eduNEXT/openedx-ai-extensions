from tutor import hooks
import os
from glob import glob

import importlib_resources
from tutormfe.hooks import PLUGIN_SLOTS
from .__about__ import __version__

hooks.Filters.CONFIG_DEFAULTS.add_items(
    [
        # Add your new settings that have default values here.
        # Each new setting is a pair: (setting_name, default_value).
        ("OPENEDX_AI_EXTENSIONS_VERSION", __version__),
        ("OPENEDX_AI_EXTENSIONS_API_KEY", None),
        ("OPENEDX_AI_EXTENSIONS_MODEL", "gpt-5-mini"),
        ("OPENEDX_AI_EXTENSIONS_TEMPERATURE", 0.7),
        ("OPENEDX_AI_EXTENSIONS_LLM_FUNCTION", "explain_like_five"),
    ]
)

@hooks.Filters.IMAGES_BUILD_MOUNTS.add()
def _mount_sample_plugin(mounts, path):
    """Mount the sample plugin source code for development."""
    mounts += [("openedx-ai-extensions/backend", "/openedx/openedx-ai-extensions/backend")]
    return mounts


for path in glob(str(importlib_resources.files("openedx_ai_extensions") / "patches" / "*")):
    with open(path, encoding="utf-8") as patch_file:
        hooks.Filters.ENV_PATCHES.add_item((os.path.basename(path), patch_file.read()))

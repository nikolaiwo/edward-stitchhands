"""Convert an SVG (sized in mm) to embroidery files by driving Ink/Stitch's classes directly.

Entry point: ``convert(svg, options_json, formats, base_name)``. Requires ``<root>/inkstitch`` (for ``lib``)
and ``<root>`` (for ``inkex`` and ``edward``) on ``sys.path``; see ``bootstrap`` in the engine worker.

Return value (everything is plain Python data so it crosses the Pyodide boundary cheaply)::

    {
      "files":    {"dst": bytes, ...},            # one entry per requested format
      "plan": {
        "widthMm": float, "heightMm": float,      # SVG canvas size
        "stitchCount": int, "jumpCount": int, "trimCount": int,
        "blocks": [{"color": "#rrggbb", "threadName": str | None,
                    "coords": bytes,              # float32 LE, interleaved x,y in mm (origin top-left, y down)
                    "flags": bytes}],             # uint8 per stitch: 0 normal, 1 jump, 2 trim-before-this-stitch
      },
      "warnings": [str, ...],
    }
"""

import gc
import json
import os
import re
import tempfile
from functools import _lru_cache_wrapper

os.environ.setdefault("INKSTITCH_OFFLINE_SCRIPT", "1")

from edward import gui_stubs  # noqa: E402,F401  (must run before importing Ink/Stitch's lib)

import inkex  # noqa: E402
import numpy as np  # noqa: E402

from lib.elements import iterate_nodes, node_to_elements  # noqa: E402
from lib.elements.element import EmbroideryElement  # noqa: E402
from lib.exceptions import InkstitchException  # noqa: E402
from lib.metadata import InkStitchMetadata  # noqa: E402
from lib.output import write_embroidery_file  # noqa: E402
from lib.stitch_plan import stitch_groups_to_stitch_plan  # noqa: E402
from lib.svg import PIXELS_PER_MM  # noqa: E402
from lib.svg.tags import EMBROIDERABLE_TAGS  # noqa: E402
from lib.svg.units import get_doc_size  # noqa: E402
from lib.threads import ThreadCatalog  # noqa: E402
from lib.update import update_inkstitch_document  # noqa: E402
from lib.utils.settings import global_settings  # noqa: E402

NORMAL, JUMP, TRIM = 0, 1, 2


class NothingToStitchError(Exception):
    """The drawing contains nothing Ink/Stitch can embroider."""


def _ns(name):
    return inkex.addNS(name, "inkstitch")


def _clean(text):
    """Collapse whitespace so multi-paragraph Ink/Stitch messages stay readable as one-liners."""
    return re.sub(r"\s+", " ", str(text)).strip()


def _label(element):
    node = element.node
    return node.get("id") or node.tag.split("}")[-1]


def _apply_options(root, options, warnings):
    """Set ``inkstitch:*`` params on every embroiderable node according to the ConvertOptions.

    Attributes already present in the SVG (e.g. authored in Inkscape) are left alone.
    """
    fill, running = options["fill"], options["running"]
    satin_min = options.get("satinMinStrokeWidthMm")
    params = {
        "row_spacing_mm": fill["rowSpacingMm"],
        "angle": fill["angleDeg"],
        "max_stitch_length_mm": fill["maxStitchLenMm"],
        "fill_underlay": fill["underlay"],
        "running_stitch_length_mm": running["stitchLenMm"],
        "bean_stitch_repeats": running["beanRepeats"],
    }
    if not options["lockStitches"]:
        params["ties"] = 3  # Neither

    satin_count = 0
    for node in root.iter():
        if not isinstance(node.tag, str) or node.tag not in EMBROIDERABLE_TAGS:
            continue
        for name, value in params.items():
            attr = _ns(name)
            if node.get(attr) is None:
                node.set(attr, json.dumps(value) if isinstance(value, bool) else str(value))

        if satin_min is not None and node.get(_ns("satin_column")) is None:
            element = EmbroideryElement(node)
            # A stroked, wide-enough path becomes a satin column of that width. Ink/Stitch turns a single
            # stroked path into rails + rungs itself (SatinColumn.filtered_subpaths).
            if element.stroke_color is not None and element.stroke_width / PIXELS_PER_MM >= satin_min:
                node.set(_ns("satin_column"), "true")
                satin_count += 1
    return satin_count


# Hints that only make sense inside Inkscape (we create these satins ourselves on purpose).
_IGNORED_WARNINGS = {"StrokeSatinWarning"}


def _collect_elements(root, warnings):
    """Return stitchable elements; report problems as warnings and skip invalid ones."""
    elements = []
    seen = set()

    def warn(msg):
        if msg not in seen:
            seen.add(msg)
            warnings.append(msg)

    # troubleshoot=True also yields text/images, which only produce "won't be embroidered" warnings
    for node in iterate_nodes(root, troubleshoot=True):
        for element in node_to_elements(node):
            try:
                errors = list(element.validation_errors())
                for w in element.validation_warnings():
                    if type(w).__name__ in _IGNORED_WARNINGS:
                        continue
                    warn(f"{_label(element)}: {_clean(w.name)} - {_clean(w.description)}")
            except Exception as e:  # a broken shape must not take the whole conversion down
                warn(f"{_label(element)}: could not be checked ({_clean(e)}), skipped")
                continue
            if errors:
                for err in errors:
                    warn(f"{_label(element)}: {_clean(err.name)} - {_clean(err.description)} (skipped)")
                continue
            elements.append(element)
    return elements


def _stitch_groups(elements, trim_len_mm, warnings):
    groups = []
    last_group = None
    trim_px = trim_len_mm * PIXELS_PER_MM
    pairs = list(zip(elements, elements[1:] + [None]))
    for element, next_element in pairs:
        try:
            new_groups = element.embroider(last_group, next_element)
        except InkstitchException as e:
            warnings.append(f"{_label(element)}: skipped - {_clean(e)}")
            continue
        if not new_groups:
            continue
        # Same idea as Ink/Stitch's "jump to trim" extension: long jumps within one colour get a trim.
        if last_group is not None and new_groups[0].color == last_group.color:
            gap = (new_groups[0].stitches[0] - last_group.stitches[-1]).length()
            if gap > trim_px:
                last_group.trim_after = True
        groups.extend(new_groups)
        last_group = new_groups[-1]
    return groups


def _thread_name(color):
    parts = [p for p in (color.manufacturer, color.number) if p]
    if parts:
        return " ".join(parts)
    return color.name or None


def _plan_to_data(stitch_plan, width_mm, height_mm):
    blocks = []
    counts = {NORMAL: 0, JUMP: 0, TRIM: 0}
    for block in stitch_plan:
        coords, flags = [], []
        pending_trim = False
        for s in block:
            if s.trim:
                pending_trim = True
                continue
            if s.color_change or s.stop:
                continue
            flag = JUMP if s.jump else NORMAL
            if pending_trim:
                flag, pending_trim = TRIM, False
            counts[flag] += 1
            coords.append((s.x / PIXELS_PER_MM, s.y / PIXELS_PER_MM))
            flags.append(flag)
        if not coords:
            continue
        rgb = block.color.rgb
        blocks.append({
            "color": "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb),
            "threadName": _thread_name(block.color),
            "coords": np.asarray(coords, dtype="<f4").tobytes(),
            "flags": np.asarray(flags, dtype="u1").tobytes(),
        })
    return {
        "widthMm": width_mm,
        "heightMm": height_mm,
        "stitchCount": counts[NORMAL],
        "jumpCount": counts[JUMP],
        "trimCount": counts[TRIM],
        "blocks": blocks,
    }


def _write_files(stitch_plan, root, formats):
    files = {}
    with tempfile.TemporaryDirectory() as tmp:
        for fmt in formats:
            path = os.path.join(tmp, f"design.{fmt}")
            # write_embroidery_file mutates (and expects ownership of) the settings dict
            write_embroidery_file(path, stitch_plan, root, {})
            with open(path, "rb") as f:
                files[fmt] = f.read()
    return files


def _release_caches():
    """Ink/Stitch memoises element properties with unbounded lru_caches keyed on the element, which would
    keep every converted document alive in a long-lived worker."""
    for obj in gc.get_objects():
        if isinstance(obj, _lru_cache_wrapper):
            obj.cache_clear()
    gc.collect()


def convert(svg, options_json, formats, base_name="design"):
    options = json.loads(options_json)
    warnings = []
    global_settings._settings["cache_size"] = 0  # no on-disk stitch plan cache in the browser

    try:
        doc = inkex.load_svg(svg.encode("utf-8"))
        root = doc.getroot()
        root.set(inkex.addNS("docname", "sodipodi"), f"{base_name}.svg")
        update_inkstitch_document(doc)

        metadata = InkStitchMetadata(root)
        metadata["min_stitch_len_mm"] = options["minStitchLenMm"]
        metadata["collapse_len_mm"] = options["trimJumpsLongerThanMm"]
        if options.get("satinMinStrokeWidthMm") is not None:
            metadata["min_satin_stroke_width_mm"] = options["satinMinStrokeWidthMm"]

        _apply_options(root, options, warnings)
        elements = _collect_elements(root, warnings)
        groups = _stitch_groups(elements, options["trimJumpsLongerThanMm"], warnings)
        if not groups:
            message = "Nothing to stitch: the drawing has no filled or stroked shapes that can be embroidered."
            if warnings:
                message += f" ({warnings[0]})"
            raise NothingToStitchError(message)

        stitch_plan = stitch_groups_to_stitch_plan(
            groups,
            collapse_len=metadata["collapse_len_mm"],
            disable_ties=not options["lockStitches"],
            min_stitch_len=metadata["min_stitch_len_mm"],
        )
        ThreadCatalog().match_and_apply_palette(stitch_plan, metadata["thread-palette"])

        width_px, height_px = get_doc_size(root)
        plan = _plan_to_data(stitch_plan, width_px / PIXELS_PER_MM, height_px / PIXELS_PER_MM)
        files = _write_files(stitch_plan, root, formats)
        return {"files": files, "plan": plan, "warnings": warnings}
    finally:
        _release_caches()

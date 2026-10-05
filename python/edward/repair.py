"""Repair self-crossing / unconnected fill paths before Ink/Stitch sees them.

Ink/Stitch builds a fill as "largest subpath = shell, the rest = holes" and ignores the SVG fill-rule. For a
path whose border crosses itself that guess is often wrong (wrong holes) and the result is one object made of
several pieces stitched in no meaningful order. Here we rebuild the filled area the way a browser renders it
(honouring fill-rule nonzero/evenodd) and replace the element with one clean path per connected piece, ordered
top-to-bottom, left-to-right. This is what Ink/Stitch's "Break Apart Fill Objects" does, minus the guessing.
"""

from copy import deepcopy

import inkex
from shapely import make_valid
from shapely.geometry import LinearRing, LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

from lib.elements.element import EmbroideryElement
from lib.svg import PIXELS_PER_MM, get_correction_transform
from lib.svg.tags import SVG_PATH_TAG
from lib.utils.geometry import ensure_multi_polygon

# pieces smaller than this are slivers produced by the crossing itself, not real shapes
MIN_PIECE_AREA_MM2 = 0.5


def _winding_number(point, ring):
    """Signed number of times ``ring`` winds around ``point`` (standard crossing-direction algorithm)."""
    px, py = point
    winding = 0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if y1 <= py:
            if y2 > py and (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0:
                winding += 1
        elif y2 <= py and (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0:
            winding -= 1
    return winding


def filled_area(rings, fill_rule):
    """The area a renderer would paint for these closed rings under the given SVG fill-rule."""
    rings = [ring for ring in rings if len(ring) >= 3]
    edges = unary_union([LineString(ring + ring[:1]) for ring in rings])
    filled = []
    for face in polygonize(edges):
        point = face.representative_point()
        windings = [_winding_number((point.x, point.y), ring) for ring in rings]
        if fill_rule == "evenodd":
            inside = sum(abs(w) for w in windings) % 2 == 1
        else:
            inside = sum(windings) != 0
        if inside:
            filled.append(face)
    return ensure_multi_polygon(make_valid(unary_union(filled)))


def _needs_repair(rings):
    rings = sorted((ring for ring in rings if len(ring) >= 3), key=lambda ring: Polygon(ring).area, reverse=True)
    if not rings:
        return False
    if any(not LinearRing(ring).is_simple for ring in rings):
        return True
    return not MultiPolygon([(rings[0], rings[1:])]).is_valid


def _polygon_to_path(polygon):
    path = inkex.Path()
    for ring in [polygon.exterior, *polygon.interiors]:
        sub = inkex.Path(list(ring.coords))
        sub.close()
        path += sub
    return path


def repair_fills(root):
    """Split self-crossing / unconnected fill paths in place. Returns the number of elements repaired."""
    repaired = 0
    min_area = MIN_PIECE_AREA_MM2 * PIXELS_PER_MM ** 2
    for node in list(root.iter(SVG_PATH_TAG)):
        element = EmbroideryElement(node)
        if not element.fill_color or node.getparent() is None:
            continue
        rings = [[tuple(p) for p in ring] for ring in element.flatten(element.parse_path())]
        if not _needs_repair(rings):
            continue

        fill_rule = (node.specified_style().get("fill-rule") or "nonzero").strip()
        pieces = [p for p in filled_area(rings, fill_rule).geoms if p.area >= min_area]
        if not pieces:
            continue
        # stitch order: top-to-bottom, then left-to-right
        pieces.sort(key=lambda p: (round(p.bounds[1]), p.bounds[0]))

        parent = node.getparent()
        index = parent.index(node)
        correction = get_correction_transform(node)
        base_id = node.get("id") or "path"
        has_stroke = element.stroke_color is not None
        for i, piece in enumerate(pieces):
            new = deepcopy(node)
            new.set("id", root.get_unique_id(f"{base_id}_part{i + 1}_") if len(pieces) > 1 else base_id + "_fixed")
            new.set("d", str(_polygon_to_path(piece)))
            new.set("transform", correction)
            new.style["fill-rule"] = "evenodd"
            if has_stroke:
                new.style["stroke"] = "none"
            parent.insert(index + i, new)

        if has_stroke:
            node.style["fill"] = "none"  # keep the original outline for the stroke, stitched after the fill
        else:
            parent.remove(node)
        repaired += 1
    return repaired

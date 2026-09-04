#!/usr/bin/env python3
"""
site_intel.py -- Land feasibility site intelligence for Collin County, TX
                 (Prosper + Melissa focus)

Takes an address, lat/lon, or CAD property id and returns the physical,
regulatory and contextual picture of a tract -- ending in a net developable
acreage calculation you can drop straight into the feasibility model.

All data sources are free and public. No API keys. Stdlib only.

Usage:
    python3 site_intel.py --address "870 Sagebrush Dr, Prosper, TX"
    python3 site_intel.py --latlon 33.2562,-96.8116
    python3 site_intel.py --prop-id 2696080
    python3 site_intel.py --latlon 33.2562,-96.8116 --json out.json

Assumption flags (these drive the yield math -- set them per deal):
    --open-space-pct 15      municipal open space / park dedication
    --row-pct 22             internal street + ROW take
    --stream-buffer-ft 50    riparian / drainage setback
    --max-slope-pct 15       slope above which land is treated as unbuildable
    --density 2.5            units per net developable acre
"""

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TIMEOUT = 45
UA = {"User-Agent": "sobha-land-intel/1.0"}

# ---------------------------------------------------------------------------
# Endpoints (all verified live)
# ---------------------------------------------------------------------------

PROSPER = "https://services8.arcgis.com/8ofMLzOrtxGP9wVQ/arcgis/rest/services"
CCAD = ("https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services"
        "/CCAD_Parcel_Feature_Set/FeatureServer")
COLLIN = "https://services1.arcgis.com/fdWXd5OobWR1E3er/arcgis/rest/services"
# www.fws.gov 301-redirects here; POST bodies do not survive the redirect, so
# address the real host directly.
NWI = ("https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services"
       "/Wetlands/MapServer")
RRC = ("https://gis.rrc.texas.gov/server/rest/services/rrc_public"
       "/RRC_Public_Viewer_Srvs/MapServer")

LAYERS = {
    # jurisdiction / regulatory
    "prosper_parcels":   f"{PROSPER}/Land_Records/FeatureServer/6",
    "prosper_preconst":  f"{PROSPER}/Land_Records/FeatureServer/5",
    "prosper_subdiv":    f"{PROSPER}/Land_Records/FeatureServer/4",
    "zoning":            f"{PROSPER}/Planning/FeatureServer/0",
    "planned_dev":       f"{PROSPER}/Planning/FeatureServer/9",
    "future_land_use":   f"{PROSPER}/Planning/FeatureServer/11",
    "special_use":       f"{PROSPER}/Planning/FeatureServer/12",
    "current_dev":       f"{PROSPER}/Planning/FeatureServer/3",
    "thoroughfare":      f"{PROSPER}/Planning/FeatureServer/5",
    "town_etj":          f"{PROSPER}/Administrative_Boundaries/FeatureServer/12",
    "etj_releases":      f"{PROSPER}/Administrative_Boundaries/FeatureServer/10",
    "annexations":       f"{PROSPER}/Administrative_Boundaries/FeatureServer/0",
    # physical constraints
    "floodplain":        f"{PROSPER}/Environmental/FeatureServer/7",
    "ponds_lakes":       f"{PROSPER}/Environmental/FeatureServer/0",
    "streams":           f"{PROSPER}/Environmental/FeatureServer/1",
    # context
    "poi":               f"{PROSPER}/Points_of_Interest_Facilities/FeatureServer/6",
    "schools":           f"{PROSPER}/Points_of_Interest_Facilities/FeatureServer/0",
    "roads":             f"{PROSPER}/Transportation/FeatureServer/3",
    # federal / state layers (statewide -- cover both cities)
    "nwi_wetlands":      f"{NWI}/0",
    "rrc_wells":         f"{RRC}/1",
    "rrc_orphan_wells":  f"{RRC}/2",
    "rrc_injection":     f"{RRC}/4",
    "rrc_pipelines":     f"{RRC}/14",
    # county-wide fallbacks (cover Melissa and every other Collin city)
    "co_floodplain":     f"{COLLIN}/Floodplain/FeatureServer/0",
    "co_streams":        f"{COLLIN}/Streams/FeatureServer/0",
    "co_lakes":          f"{COLLIN}/Lakes/FeatureServer/0",
    "co_thoroughfare":   f"{COLLIN}/Tplan/FeatureServer/0",
    "co_outerloop":      f"{COLLIN}/OuterLoop/FeatureServer/0",
    "co_etj":            f"{COLLIN}/ETJs/FeatureServer/0",
    # county-wide
    "ccad_parcels":      f"{CCAD}/4",
    "ccad_city_limits":  f"{CCAD}/6",
    "ccad_school_dist":  f"{CCAD}/2",
    "ccad_special_dist": f"{CCAD}/7",
}

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
EPQS = "https://epqs.nationalmap.gov/v1/json"
SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"

# FEMA zones that are a Special Flood Hazard Area (unbuildable without a LOMR)
SFHA_ZONES = {"A", "AE", "AH", "AO", "A99", "AR", "V", "VE"}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _post(url, data, headers=None, timeout=TIMEOUT):
    body = data.encode() if isinstance(data, str) else urllib.parse.urlencode(data).encode()
    hdrs = dict(UA)
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _get(url, params, timeout=TIMEOUT):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def arc_query(layer, **params):
    """Query an ArcGIS FeatureServer layer. POSTs so long geometries survive."""
    p = {"f": "json", "outFields": "*", "returnGeometry": "false",
         "outSR": "4326", "inSR": "4326"}
    p.update({k: v for k, v in params.items() if v is not None})
    # The RRC service in particular throws transient 500s, so retry once.
    last = None
    for _ in range(2):
        try:
            d = _post(layer + "/query", p)
        except Exception as e:
            last = str(e)
            continue
        if "error" not in d:
            return d
        last = d["error"]
    return {"error": last, "features": []}


def arc_point(layer, lon, lat, **kw):
    return arc_query(layer,
                     geometry=json.dumps({"x": lon, "y": lat,
                                          "spatialReference": {"wkid": 4326}}),
                     geometryType="esriGeometryPoint",
                     spatialRel="esriSpatialRelIntersects", **kw)


def arc_intersect(layer, rings, **kw):
    return arc_query(layer,
                     geometry=json.dumps({"rings": rings,
                                          "spatialReference": {"wkid": 4326}}),
                     geometryType="esriGeometryPolygon",
                     spatialRel="esriSpatialRelIntersects", **kw)


def arc_envelope(layer, bbox, **kw):
    xmin, ymin, xmax, ymax = bbox
    return arc_query(layer,
                     geometry=json.dumps({"xmin": xmin, "ymin": ymin,
                                          "xmax": xmax, "ymax": ymax,
                                          "spatialReference": {"wkid": 4326}}),
                     geometryType="esriGeometryEnvelope",
                     spatialRel="esriSpatialRelIntersects", **kw)


# ---------------------------------------------------------------------------
# Geometry (local equirectangular projection to feet -- exact enough at
# parcel scale, and keeps us dependency-free)
# ---------------------------------------------------------------------------

FT_PER_DEG_LAT = 364000.0


class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = FT_PER_DEG_LAT * math.cos(math.radians(lat0))
        self.ky = FT_PER_DEG_LAT

    def to_ft(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def to_deg(self, x, y):
        return (self.lon0 + x / self.kx, self.lat0 + y / self.ky)


def ring_area(ring):
    """Signed shoelace area of a ring of (x, y) tuples."""
    a = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def polygon_area_sqft(rings, proj):
    total = 0.0
    for ring in rings:
        pts = [proj.to_ft(p[0], p[1]) for p in ring]
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        total += ring_area(pts)
    return abs(total)


def point_in_rings(px, py, rings_ft):
    """Ray casting across all rings; XOR handles donut holes correctly."""
    inside = False
    for ring in rings_ft:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if ((yi > py) != (yj > py)) and \
               (px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-12) + xi):
                inside = not inside
            j = i
    return inside


def dist_point_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def min_dist_to_paths(px, py, paths_ft):
    best = float("inf")
    for path in paths_ft:
        for i in range(len(path) - 1):
            d = dist_point_to_segment(px, py, path[i][0], path[i][1],
                                      path[i + 1][0], path[i + 1][1])
            if d < best:
                best = d
    return best


def feature_rings_ft(feat, proj):
    g = feat.get("geometry") or {}
    out = []
    for ring in g.get("rings", []):
        pts = [proj.to_ft(p[0], p[1]) for p in ring]
        if pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        out.append(pts)
    return out


def feature_paths_ft(feat, proj):
    g = feat.get("geometry") or {}
    return [[proj.to_ft(p[0], p[1]) for p in path] for path in g.get("paths", [])]


# ---------------------------------------------------------------------------
# Locate the tract
# ---------------------------------------------------------------------------

def geocode(address):
    d = _get(CENSUS_GEOCODER, {"address": address,
                               "benchmark": "Public_AR_Current",
                               "format": "json"})
    m = d.get("result", {}).get("addressMatches", [])
    if not m:
        return None
    c = m[0]["coordinates"]
    return (c["y"], c["x"], m[0].get("matchedAddress"))


def find_parcel(lat=None, lon=None, prop_id=None):
    """Prosper's own parcel layer first (richer), then CCAD county-wide."""
    if prop_id is not None:
        r = arc_query(LAYERS["prosper_parcels"], where=f"prop_id={int(prop_id)}",
                      returnGeometry="true")
        if r.get("features"):
            return r["features"][0], "Town of Prosper"
        r = arc_query(LAYERS["ccad_parcels"], where=f"PROP_ID={int(prop_id)}",
                      returnGeometry="true")
        if r.get("features"):
            return r["features"][0], "Collin CAD"
        return None, None

    r = arc_point(LAYERS["prosper_parcels"], lon, lat, returnGeometry="true")
    if r.get("features"):
        return r["features"][0], "Town of Prosper"
    r = arc_point(LAYERS["ccad_parcels"], lon, lat, returnGeometry="true")
    if r.get("features"):
        return r["features"][0], "Collin CAD"
    return None, None


def parcel_centroid(rings):
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    return (sum(ys) / len(ys), sum(xs) / len(xs))


# ---------------------------------------------------------------------------
# Soils (USDA SSURGO via Soil Data Access)
# ---------------------------------------------------------------------------

def wkt_from_rings(rings):
    parts = []
    for ring in rings:
        pts = list(ring)
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        parts.append("(" + ",".join(f"{p[0]:.8f} {p[1]:.8f}" for p in pts) + ")")
    return "polygon(" + ",".join(parts) + ")"


def soils(rings):
    """Map units under the tract, with the properties that drive slab cost."""
    wkt = wkt_from_rings(rings)
    q = ("SELECT mu.mukey, mu.muname, c.compname, c.comppct_r, c.drainagecl, "
         "c.hydgrp, c.slope_r, "
         "(SELECT TOP 1 ch.lep_r FROM chorizon ch WHERE ch.cokey = c.cokey "
         " ORDER BY ch.hzdept_r) AS lep_r, "
         "(SELECT TOP 1 ch.pi_r FROM chorizon ch WHERE ch.cokey = c.cokey "
         " ORDER BY ch.hzdept_r) AS plasticity_index "
         f"FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('{wkt}') AS m "
         "INNER JOIN mapunit mu ON mu.mukey = m.mukey "
         "INNER JOIN component c ON c.mukey = mu.mukey "
         "WHERE c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC")
    try:
        d = _post(SDA, json.dumps({"format": "JSON", "query": q}),
                  {"Content-Type": "application/json"})
    except Exception as e:
        return {"error": str(e), "units": []}
    rows = d.get("Table") or []
    units = []
    for r in rows:
        units.append({
            "mukey": r[0], "map_unit": r[1], "component": r[2],
            "component_pct": _num(r[3]), "drainage": r[4], "hydro_group": r[5],
            "slope_pct": _num(r[6]),
            "linear_extensibility_pct": _num(r[7]),
            "plasticity_index": _num(r[8]),
        })
    return {"units": units}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def shrink_swell_flag(units):
    """Linear extensibility >= 6% is the USDA 'high shrink-swell' threshold."""
    worst = None
    for u in units:
        lep = u.get("linear_extensibility_pct")
        if lep is not None and (worst is None or lep > worst):
            worst = lep
    if worst is None:
        return "unknown", None
    if worst >= 9:
        return "very high", worst
    if worst >= 6:
        return "high", worst
    if worst >= 3:
        return "moderate", worst
    return "low", worst


# ---------------------------------------------------------------------------
# Terrain
# ---------------------------------------------------------------------------

def elevation(lat, lon, tries=3):
    """EPQS drops requests under concurrency; retry or the relief figure
    swings between runs purely on how many samples survived."""
    for _ in range(tries):
        try:
            d = _get(EPQS, {"x": lon, "y": lat, "units": "Feet", "wkid": 4326},
                     timeout=25)
            v = d.get("value")
            if v is not None:
                return float(v)
        except Exception:
            pass
    return None


def terrain(sample_pts_deg, spacing_ft, max_samples=48):
    """Sample 3DEP over the tract; derive relief and a slope distribution."""
    pts = sample_pts_deg
    if len(pts) > max_samples:
        step = len(pts) / float(max_samples)
        pts = [pts[int(i * step)] for i in range(max_samples)]
    with ThreadPoolExecutor(max_workers=12) as ex:
        elevs = list(ex.map(lambda p: elevation(p[1], p[0]), pts))

    got = [(p, e) for p, e in zip(pts, elevs) if e is not None]
    if len(got) < 3:
        return {"error": "elevation service returned too few samples"}

    vals = [e for _, e in got]
    # Slope: for each sample, steepest gradient to any neighbour within
    # ~1.6 grid cells. Coarse but honest at screening resolution.
    proj = Proj(got[0][0][1], got[0][0][0])
    xy = [(proj.to_ft(p[0], p[1]), e) for p, e in got]
    # Subsampling widens the effective grid, so derive the neighbourhood
    # radius from the actual point spacing rather than the source grid.
    nn = []
    for (x1, y1), _ in xy:
        d = min((math.hypot(x2 - x1, y2 - y1)
                 for (x2, y2), _ in xy if (x2, y2) != (x1, y1)), default=spacing_ft)
        nn.append(d)
    nn.sort()
    radius = max(nn[len(nn) // 2] * 1.6, spacing_ft)
    slopes = []
    for (x1, y1), e1 in xy:
        best = 0.0
        for (x2, y2), e2 in xy:
            d = math.hypot(x2 - x1, y2 - y1)
            if 0 < d <= radius:
                best = max(best, abs(e2 - e1) / d * 100.0)
        slopes.append(best)
    raw_slopes = list(slopes)          # keep sample order for grid assignment
    slopes = sorted(slopes)
    return {
        "samples": len(got),
        "min_ft": round(min(vals), 1),
        "max_ft": round(max(vals), 1),
        "relief_ft": round(max(vals) - min(vals), 1),
        "sample_spacing_ft": round(radius / 1.6),
        "mean_slope_pct": round(sum(slopes) / len(slopes), 2),
        "p90_slope_pct": round(slopes[int(len(slopes) * 0.9)], 2),
        "max_slope_pct": round(slopes[-1], 2),
        "_slopes": slopes,
        # (lon, lat, slope_pct) so callers can assign a slope to each grid cell
        "_samples": [(p[0], p[1], s) for (p, _), s in zip(got, raw_slopes)],
    }


# ---------------------------------------------------------------------------
# The analysis
# ---------------------------------------------------------------------------

def build_grid(rings_ft, bbox_ft, target=400):
    """Equal-area sample grid clipped to the parcel. Each point = 1/N of area."""
    xmin, ymin, xmax, ymax = bbox_ft
    w, h = max(xmax - xmin, 1.0), max(ymax - ymin, 1.0)
    spacing = math.sqrt(w * h / max(target, 1))
    pts = []
    ny = max(int(h / spacing), 1)
    nx = max(int(w / spacing), 1)
    for j in range(ny):
        for i in range(nx):
            x = xmin + (i + 0.5) * w / nx
            y = ymin + (j + 0.5) * h / ny
            if point_in_rings(x, y, rings_ft):
                pts.append((x, y))
    return pts, spacing


def analyse(args):
    out = {"input": {}, "assumptions": vars(args).copy()}

    # ---- locate ----------------------------------------------------------
    lat = lon = None
    if args.address:
        g = geocode(args.address)
        if not g:
            return {"error": f"Could not geocode: {args.address}"}
        lat, lon, matched = g
        out["input"] = {"address": args.address, "matched_address": matched,
                        "lat": lat, "lon": lon}
    elif args.latlon:
        lat, lon = [float(v) for v in args.latlon.split(",")]
        out["input"] = {"lat": lat, "lon": lon}

    parcel, source = find_parcel(lat, lon, args.prop_id)
    if not parcel:
        return {"error": "No parcel found at that location. "
                         "Outside Collin CAD coverage, or in road right-of-way."}

    rings = parcel["geometry"]["rings"]
    if lat is None:
        lat, lon = parcel_centroid(rings)
        out["input"] = {"prop_id": args.prop_id, "lat": lat, "lon": lon}

    proj = Proj(lat, lon)
    rings_ft = [[proj.to_ft(p[0], p[1]) for p in r] for r in rings]
    for r in rings_ft:
        if r[0] != r[-1]:
            r.append(r[0])

    gross_sqft = polygon_area_sqft(rings, proj)
    gross_ac = gross_sqft / 43560.0

    a = parcel["attributes"]
    out["parcel"] = {
        "source": source,
        "prop_id": a.get("prop_id") or a.get("PROP_ID"),
        "geo_id": a.get("geo_id") or a.get("geoID"),
        "owner": a.get("file_as_name") or a.get("ownerName"),
        "owner_mailing": " ".join(str(x) for x in [
            a.get("ownerAddrLine1"), a.get("ownerAddrCity"),
            a.get("ownerAddrState"), a.get("ownerAddrZip")] if x) or None,
        "legal": a.get("legal_desc") or a.get("legalDescription"),
        "situs": " ".join(str(x) for x in [
            a.get("addr_line2"), a.get("situsBldgNum"),
            a.get("situsStreetName"), a.get("situsCity")] if x),
        "gross_acres": round(gross_ac, 3),
        "gross_sqft": round(gross_sqft),
        "cad_land_acres": _num(a.get("landSizeAcres")),
        "cad_ag_exempt_acres": _num(a.get("landAgAcres")),
        "cad_land_value": _num(a.get("currValLand")),
        "cad_market_value": _num(a.get("currValMarket")),
    }

    xs = [p[0] for r in rings_ft for p in r]
    ys = [p[1] for r in rings_ft for p in r]
    bbox_ft = (min(xs), min(ys), max(xs), max(ys))
    grid, spacing = build_grid(rings_ft, bbox_ft)
    if not grid:
        grid = [(sum(xs) / len(xs), sum(ys) / len(ys))]
        spacing = 100.0
    cell_ac = gross_ac / len(grid)

    # ---- jurisdiction & regulatory --------------------------------------
    reg = {}
    j = arc_point(LAYERS["town_etj"], lon, lat)
    reg["prosper_jurisdiction"] = (j["features"][0]["attributes"].get("NAME")
                                   if j.get("features") else None)
    cl = arc_point(LAYERS["ccad_city_limits"], lon, lat)
    if cl.get("features"):
        reg["city_limits"] = cl["features"][0]["attributes"].get("CITYNAME")
    sd = arc_point(LAYERS["ccad_school_dist"], lon, lat)
    if sd.get("features"):
        reg["school_district"] = sd["features"][0]["attributes"].get("ISDNAME")
    spd = arc_point(LAYERS["ccad_special_dist"], lon, lat)
    reg["special_districts"] = [
        f"{f['attributes'].get('Name')} ({f['attributes'].get('Type')})"
        for f in spd.get("features", [])]

    z = arc_point(LAYERS["zoning"], lon, lat)
    if z.get("features"):
        za = z["features"][0]["attributes"]
        reg["zoning"] = {"zone": za.get("ZONE_"), "class": za.get("Zoning_Class"),
                         "pd": za.get("PD"), "sup": za.get("SUP"),
                         "ordinances": [x for x in (za.get("ORD1"), za.get("ORD2")) if x]}
    flu = arc_point(LAYERS["future_land_use"], lon, lat)
    if flu.get("features"):
        reg["future_land_use"] = flu["features"][0]["attributes"].get("Description")
    etjr = arc_point(LAYERS["etj_releases"], lon, lat)
    reg["in_etj_release_area"] = bool(etjr.get("features"))
    out["regulatory"] = reg

    # ---- constraints (grid classification) -------------------------------
    con = {}
    in_prosper = reg.get("prosper_jurisdiction") is not None

    def dual(town_key, county_key, fetch):
        """Prefer the town layer inside Prosper; fall back to the county layer.

        Coverage is reported explicitly -- a layer that does not extend over
        the site must never read as 'nothing found'.
        """
        order = ([("town", town_key), ("county", county_key)] if in_prosper
                 else [("county", county_key), ("town", town_key)])
        reached = None
        for src, key in order:
            r = fetch(LAYERS[key])
            if r.get("error"):
                continue
            if r.get("features"):
                return r["features"], src
            reached = reached or src
        # Reached a working layer that simply had nothing here -> a true zero.
        # Reached none of them -> unknown, and the caller must say so.
        return [], (reached or "NO COVERAGE")

    fl_feats, fl_src = dual(
        "floodplain", "co_floodplain",
        lambda u: arc_intersect(u, rings, returnGeometry="true"))
    flood_zones, sfha_polys = set(), []
    for f in fl_feats:
        zone = (f["attributes"].get("FLD_ZONE") or "").strip().upper()
        subty = (f["attributes"].get("ZONE_SUBTY") or "").strip()
        flood_zones.add(zone + (f" ({subty})" if subty else ""))
        if zone in SFHA_ZONES or "FLOODWAY" in subty.upper():
            sfha_polys.append(feature_rings_ft(f, proj))
    # Per-grid-point constraint flags. Constraints overlap heavily (ponds sit
    # inside floodplain, streams run through both), so the yield deduction
    # must use the UNION of flagged points, never the sum of each layer.
    flags = [{"sfha": False, "water": False, "stream": False, "steep": False,
              "wetland": False} for _ in grid]

    for i, (x, y) in enumerate(grid):
        if any(point_in_rings(x, y, rgs) for rgs in sfha_polys):
            flags[i]["sfha"] = True
    flood_hits = sum(1 for f in flags if f["sfha"])
    con["floodplain"] = {
        "source": fl_src,
        "zones_present": sorted(flood_zones) or ["none intersecting site"],
        "sfha_acres": round(flood_hits * cell_ac, 3),
        "sfha_pct": round(100.0 * flood_hits / len(grid), 1),
    }

    wb_feats, wb_src = dual(
        "ponds_lakes", "co_lakes",
        lambda u: arc_intersect(u, rings, returnGeometry="true"))
    wb_polys = [feature_rings_ft(f, proj) for f in wb_feats]
    for i, (x, y) in enumerate(grid):
        if any(point_in_rings(x, y, rgs) for rgs in wb_polys):
            flags[i]["water"] = True
    wb_hits = sum(1 for f in flags if f["water"])
    con["water_bodies"] = {"source": wb_src, "count": len(wb_polys),
                           "acres": round(wb_hits * cell_ac, 3)}

    st_feats, st_src = dual(
        "streams", "co_streams",
        lambda u: arc_envelope(u, _bbox_deg(rings, 0.004), returnGeometry="true"))
    st_paths = [p for f in st_feats for p in feature_paths_ft(f, proj)]
    buf = args.stream_buffer_ft
    if st_paths:
        for i, (x, y) in enumerate(grid):
            if min_dist_to_paths(x, y, st_paths) <= buf:
                flags[i]["stream"] = True
    stream_hits = sum(1 for f in flags if f["stream"])
    con["streams"] = {"source": st_src, "segments_nearby": len(st_paths),
                      "buffer_ft": buf,
                      "buffer_acres": round(stream_hits * cell_ac, 3)}

    # National Wetlands Inventory. A mapped wetland is a Clean Water Act s.404
    # permitting question, not merely a soggy patch -- treat as unbuildable at
    # screening and confirm with a jurisdictional determination.
    wl = arc_intersect(LAYERS["nwi_wetlands"], rings, returnGeometry="true")
    wl_polys, wl_types = [], {}
    for f in wl.get("features", []):
        at = {k.split(".")[-1]: v for k, v in f["attributes"].items()}
        t = at.get("WETLAND_TYPE") or "Unclassified"
        wl_types[t] = wl_types.get(t, 0) + 1
        wl_polys.append(feature_rings_ft(f, proj))
    for i, (x, y) in enumerate(grid):
        if any(point_in_rings(x, y, rgs) for rgs in wl_polys):
            flags[i]["wetland"] = True
    wl_hits = sum(1 for f in flags if f["wetland"])
    con["wetlands"] = {
        "source": "USFWS NWI" if not wl.get("error") else "NO COVERAGE",
        "features_on_site": len(wl_polys),
        "types": wl_types,
        "acres": round(wl_hits * cell_ac, 3),
    }

    # ---- soils -----------------------------------------------------------
    s = soils(rings)
    rating, lep = shrink_swell_flag(s.get("units", []))
    out["soils"] = {
        "units": s.get("units", []),
        "shrink_swell": rating,
        "max_linear_extensibility_pct": lep,
        "note": ("High shrink-swell drives foundation design and cost. "
                 "Blackland Prairie clays commonly require deepened / "
                 "post-tensioned slabs or moisture-conditioned subgrade -- "
                 "confirm with a geotech report before pricing."),
    }
    if s.get("error"):
        out["soils"]["error"] = s["error"]

    # ---- terrain ---------------------------------------------------------
    grid_deg = [proj.to_deg(x, y) for (x, y) in grid]
    t = terrain(grid_deg, spacing)
    if "_slopes" in t:
        t.pop("_slopes")
        # Assign each grid cell the slope of its nearest 3DEP sample.
        samples = [(proj.to_ft(lo, la), s) for lo, la, s in t.pop("_samples")]
        for i, (x, y) in enumerate(grid):
            _, s = min(samples, key=lambda sm: (sm[0][0] - x) ** 2
                       + (sm[0][1] - y) ** 2)
            if s > args.max_slope_pct:
                flags[i]["steep"] = True
    out["terrain"] = t
    steep_hits = sum(1 for f in flags if f["steep"])
    con["steep_slope"] = {"threshold_pct": args.max_slope_pct,
                          "pct_of_site": round(100.0 * steep_hits / len(grid), 1),
                          "acres": round(steep_hits * cell_ac, 3)}

    # Union of all physical constraints -- the figure that actually comes off
    # gross acreage.
    union_hits = sum(1 for f in flags if any(f.values()))
    con["combined_unbuildable"] = {
        "acres": round(union_hits * cell_ac, 3),
        "pct_of_site": round(100.0 * union_hits / len(grid), 1),
        "sum_if_double_counted": round(
            (flood_hits + wb_hits + stream_hits + steep_hits + wl_hits)
            * cell_ac, 3),
        "note": ("Union of floodplain / water / stream buffer / steep slope / "
                 "wetlands. Layers overlap, so this is less than their sum."),
    }
    con["_grid_points"] = len(grid)
    con["_acres_per_sample"] = round(cell_ac, 4)
    out["constraints"] = con

    # ---- context ---------------------------------------------------------
    ctx = {}
    bbox_1mi = _bbox_deg(rings, 0.0145)
    cd = arc_envelope(LAYERS["current_dev"], bbox_1mi)
    ctx["nearby_developments"] = [
        {k: v for k, v in f["attributes"].items()
         if v not in (None, "") and not k.startswith(
             ("OBJECTID", "Shape", "GlobalID", "created", "last_"))}
        for f in cd.get("features", [])[:25]]
    th = arc_intersect(LAYERS["thoroughfare"], rings)
    ctx["planned_thoroughfares_crossing_site"] = [
        f["attributes"] for f in th.get("features", [])]
    cth = arc_intersect(LAYERS["co_thoroughfare"], rings)
    ctx["county_thoroughfare_plan_crossing_site"] = len(cth.get("features", []))
    # Collin County Outer Loop -- the single biggest alignment-driven value
    # lever on land in this corridor.
    ol = arc_envelope(LAYERS["co_outerloop"], _bbox_deg(rings, 0.029))
    ctx["outer_loop_within_2mi"] = [
        {"name": f["attributes"].get("NAME"),
         "desc": f["attributes"].get("DESCRIPTIO"),
         "lanes": f["attributes"].get("NUMLANES")}
        for f in ol.get("features", [])][:5]
    # --- Texas mineral estate ------------------------------------------
    # The mineral estate is DOMINANT in Texas: a severed mineral owner may
    # enter and drill regardless of the surface owner's wishes. Wells and
    # pipeline easements are therefore non-negotiable diligence. These are
    # encumbrances, not area deductions -- easement widths are negotiated,
    # so we report rather than guess acreage.
    mineral = {}
    pl_on = arc_intersect(LAYERS["rrc_pipelines"], rings)
    pl_near = arc_envelope(LAYERS["rrc_pipelines"], _bbox_deg(rings, 0.0072))
    if pl_on.get("error") and pl_near.get("error"):
        mineral["pipelines"] = {"status": "QUERY FAILED -- verify manually",
                                "error": str(pl_on["error"])[:120]}
    else:
        def _pl(f):
            a = f["attributes"]
            return {"operator": a.get("OPERATOR"),
                    "commodity": a.get("COMMODITY_DESCRIPTION"),
                    "diameter_in": a.get("DIAMETER"),
                    "system": a.get("SYSTEM_NAME"),
                    "status": a.get("STATUS"),
                    "phone": a.get("CONTACT_PHONE_NUMBER")}
        mineral["pipelines"] = {
            "crossing_site": [_pl(f) for f in pl_on.get("features", [])],
            "within_half_mile": len(pl_near.get("features", [])),
        }

    wells = []
    failed = []
    for key, label in [("rrc_wells", "well"), ("rrc_orphan_wells", "orphan well"),
                       ("rrc_injection", "injection/disposal")]:
        r = arc_envelope(LAYERS[key], _bbox_deg(rings, 0.0072))
        if r.get("error"):
            failed.append(label)
            continue
        for f in r.get("features", []):
            a = f["attributes"]
            wells.append({"kind": label,
                          "type": (a.get("GIS_SYMBOL_DESCRIPTION") or "").strip(),
                          "api": a.get("API"),
                          "well_no": a.get("GIS_WELL_NUMBER")})
    mineral["wells_within_half_mile"] = wells
    if failed:
        mineral["wells_query_failed"] = failed
    ctx["mineral_estate"] = mineral

    sc = arc_envelope(LAYERS["schools"], _bbox_deg(rings, 0.029))
    ctx["schools_within_2mi"] = [
        f["attributes"].get("NAME") or f["attributes"].get("Name")
        for f in sc.get("features", [])][:20]
    out["context"] = ctx

    # ---- net developable acreage ----------------------------------------
    deductions = []
    physical = con["combined_unbuildable"]["acres"]
    after_physical = max(0.0, gross_ac - physical)

    d_row = after_physical * args.row_pct / 100.0
    d_os = after_physical * args.open_space_pct / 100.0
    net = max(0.0, after_physical - d_row - d_os)

    parts = [n for n, v in
             [("floodplain", flood_hits), ("water", wb_hits),
              ("streams", stream_hits), ("slope", steep_hits),
              ("wetlands", wl_hits)] if v]
    for label, val in [
            (f"Physical constraints [{', '.join(parts) or 'none'}]", physical),
            (f"Street / ROW take ({args.row_pct}%)", d_row),
            (f"Open space dedication ({args.open_space_pct}%)", d_os)]:
        if val > 0.0005:
            deductions.append({"item": label, "acres": round(val, 3)})

    out["yield"] = {
        "gross_acres": round(gross_ac, 3),
        "deductions": deductions,
        "net_developable_acres": round(net, 3),
        "efficiency_pct": round(100.0 * net / gross_ac, 1) if gross_ac else 0,
        "density_units_per_acre": args.density,
        "indicative_units": int(net * args.density),
        "caveat": ("Indicative only. Actual yield is governed by the PD "
                   "ordinance / zoning district lot mix, not by a blended "
                   "density. Confirm setbacks, minimum lot size, and open "
                   "space against the controlling ordinance."),
    }

    out["open_diligence"] = open_items(reg, out)
    return out


def _bbox_deg(rings, pad):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def open_items(reg, out):
    """Things no public API can answer -- flag, never fake."""
    items = [
        "Water & sewer CCN holder and capacity commitment (PUC CCN + utility "
        "will-serve letter)",
        "Wastewater capacity / lift station requirement (Prosper Wastewater "
        "Master Plan; request via city PIR)",
        "Impact fee schedule and roughly proportionate ROW/infrastructure "
        "exactions",
        "Recorded deed restrictions, easements and mineral severance "
        "(title commitment + Collin County Clerk records)",
        "Mineral severance + surface use agreement. RRC GIS shows what is "
        "PERMITTED and mapped, NOT who owns the minerals -- that is a title "
        "question and a mapped-clear site can still be encumbered.",
        "Wetlands: NWI is a desktop screen only. A jurisdictional "
        "determination from USACE is required before relying on it.",
        "Geotechnical report -- confirm shrink-swell and bearing capacity",
        "School district capacity and attendance boundary confirmation",
        "Land comps -- Texas is a non-disclosure state; sale prices are NOT "
        "public. Broker or CoStar required.",
    ]
    z = reg.get("zoning") or {}
    if z.get("pd"):
        items.insert(0, f"Read the controlling ordinance for {z['pd']} "
                        f"({', '.join(z.get('ordinances') or []) or 'ord. no. unknown'}) "
                        "-- PD districts carry bespoke setbacks, lot mix, density "
                        "and architectural standards that no zoning API exposes.")
    if not reg.get("zoning"):
        items.insert(0, "No zoning polygon available for this jurisdiction "
                        "(Melissa publishes zoning as PDF only). Request the "
                        "zoning shapefile by Public Information Request, or "
                        "georeference the adopted zoning map.")
    return items


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def render(r):
    if "error" in r:
        return f"ERROR: {r['error']}"
    L = []
    p, reg, con = r["parcel"], r["regulatory"], r["constraints"]

    L.append("=" * 72)
    L.append("SITE INTELLIGENCE REPORT")
    L.append("=" * 72)
    inp = r["input"]
    if inp.get("matched_address"):
        L.append(f"Address    : {inp['matched_address']}")
    L.append(f"Location   : {inp['lat']:.6f}, {inp['lon']:.6f}")
    L.append(f"Parcel     : prop_id {p['prop_id']}  |  geo_id {p['geo_id']}")
    if p.get("owner"):
        L.append(f"Owner      : {p['owner']}")
    if p.get("legal"):
        L.append(f"Legal      : {p['legal']}")
    L.append(f"Gross area : {p['gross_acres']} ac ({p['gross_sqft']:,} sf)"
             + (f"   [CAD says {p['cad_land_acres']} ac]"
                if p.get("cad_land_acres") else ""))
    if p.get("cad_market_value"):
        L.append(f"CAD value  : land ${(p.get('cad_land_value') or 0):,.0f}  |  "
                 f"market ${p['cad_market_value']:,.0f}   "
                 "(assessed, NOT a sale price -- TX is non-disclosure)")
    if p.get("cad_ag_exempt_acres"):
        L.append(f"Ag exempt  : {p['cad_ag_exempt_acres']} ac  "
                 "-- !! ag rollback tax (3 yrs + interest) triggers on "
                 "change of use; price it in")
    L.append(f"Source     : {p['source']}")

    L.append("")
    L.append("-- JURISDICTION & ENTITLEMENT " + "-" * 42)
    L.append(f"City limits        : {reg.get('city_limits') or 'unincorporated'}")
    L.append(f"Prosper juris.     : {reg.get('prosper_jurisdiction') or 'n/a'}")
    L.append(f"School district    : {reg.get('school_district') or 'unknown'}")
    if reg.get("special_districts"):
        L.append(f"Special districts  : {', '.join(str(x) for x in reg['special_districts'] if x) or 'none'}")
    z = reg.get("zoning")
    if z:
        L.append(f"Zoning             : {z.get('zone')} ({z.get('class')})")
        L.append(f"Planned Dev        : {z.get('pd') or 'not in a PD'}")
        if z.get("ordinances"):
            L.append(f"Ordinances         : {', '.join(z['ordinances'])}")
    else:
        L.append("Zoning             : NOT PUBLISHED AS GIS -- see open items")
    L.append(f"Future land use    : {reg.get('future_land_use') or 'n/a'}")
    if reg.get("in_etj_release_area"):
        L.append("ETJ status         : within a mapped ETJ release area (SB 2038)")

    L.append("")
    L.append("-- PHYSICAL CONSTRAINTS " + "-" * 48)
    def src(d):
        return (" !! NO LAYER COVERAGE -- treat as UNKNOWN, not zero"
                if d.get("source") == "NO COVERAGE" else f"  [{d.get('source')}]")

    f = con["floodplain"]
    L.append(f"FEMA zones         : {', '.join(f['zones_present'])}{src(f)}")
    L.append(f"SFHA / floodway    : {f['sfha_acres']} ac ({f['sfha_pct']}% of site)")
    w = con["water_bodies"]
    L.append(f"Water bodies       : {w['count']} ({w['acres']} ac){src(w)}")
    s = con["streams"]
    L.append(f"Stream buffer      : {s['buffer_acres']} ac "
             f"({s['segments_nearby']} segments @ {s['buffer_ft']} ft){src(s)}")
    ss = con["steep_slope"]
    L.append(f"Slope > {ss['threshold_pct']}%        : {ss['acres']} ac ({ss['pct_of_site']}%)")
    wl = con.get("wetlands", {})
    if wl:
        types = ", ".join(f"{k} x{v}" for k, v in wl.get("types", {}).items())
        L.append(f"Wetlands (NWI)     : {wl['acres']} ac, "
                 f"{wl['features_on_site']} features{src(wl)}"
                 + (f"  [{types}]" if types else ""))
    cu = con["combined_unbuildable"]
    L.append(f"COMBINED (union)   : {cu['acres']} ac ({cu['pct_of_site']}% of site)"
             f"   [sum of layers would be {cu['sum_if_double_counted']} ac "
             "-- they overlap]")

    t = r.get("terrain", {})
    if "relief_ft" in t:
        L.append(f"Terrain            : {t['min_ft']}-{t['max_ft']} ft "
                 f"(relief {t['relief_ft']} ft), mean slope {t['mean_slope_pct']}%, "
                 f"p90 {t['p90_slope_pct']}%  [{t['samples']} 3DEP samples "
                 f"~{t.get('sample_spacing_ft', '?')} ft apart -- screening "
                 f"resolution; localised steep banks will be smoothed out]")

    so = r.get("soils", {})
    if so.get("units"):
        L.append("")
        L.append(f"Soils (shrink-swell: {so['shrink_swell'].upper()}"
                 + (f", max LEP {so['max_linear_extensibility_pct']}%"
                    if so.get('max_linear_extensibility_pct') else "") + ")")
        seen = set()
        for u in so["units"]:
            if u["map_unit"] in seen:
                continue
            seen.add(u["map_unit"])
            bits = [f"PI {u['plasticity_index']:.0f}"] if u.get("plasticity_index") else []
            if u.get("hydro_group"):
                bits.append(f"HSG {u['hydro_group']}")
            if u.get("drainage"):
                bits.append(u["drainage"])
            L.append(f"  - {u['map_unit']}"
                     + (f"  [{', '.join(bits)}]" if bits else ""))

    ctx = r.get("context", {})
    mn = ctx.get("mineral_estate", {})
    if mn:
        L.append("")
        L.append("-- MINERAL ESTATE / OIL & GAS " + "-" * 42)
        L.append("   (In Texas the mineral estate is DOMINANT -- a severed")
        L.append("    mineral owner may enter and drill over the surface owner.)")
        pl = mn.get("pipelines", {})
        if pl.get("status"):
            L.append(f"Pipelines          : {pl['status']}")
        else:
            cross = pl.get("crossing_site", [])
            if cross:
                L.append(f"!! {len(cross)} PIPELINE(S) CROSS THIS SITE:")
                for p in cross[:6]:
                    L.append(f"   - {p['operator']} | {p['commodity']} | "
                             f"{p['diameter_in']}\" | {p['status']} | "
                             f"{p['system']}")
            else:
                L.append("Pipelines on site  : none mapped")
            L.append(f"Pipelines <=0.5 mi : {pl.get('within_half_mile', 0)} segments")
        w = mn.get("wells_within_half_mile", [])
        if w:
            kinds = {}
            for x in w:
                k = x.get("type") or x["kind"]
                kinds[k] = kinds.get(k, 0) + 1
            L.append(f"Wells <=0.5 mi     : {len(w)}  "
                     f"[{', '.join(f'{k} x{v}' for k, v in kinds.items())}]")
        else:
            L.append("Wells <=0.5 mi     : none mapped")
        if mn.get("wells_query_failed"):
            L.append(f"!! Well query FAILED for: "
                     f"{', '.join(mn['wells_query_failed'])} -- verify manually")

    if ctx.get("planned_thoroughfares_crossing_site") or \
            ctx.get("county_thoroughfare_plan_crossing_site"):
        L.append("")
        L.append("!! Planned thoroughfare crosses this site -- expect ROW dedication")
    if ctx.get("outer_loop_within_2mi"):
        names = sorted({str(o.get("name") or o.get("desc"))
                        for o in ctx["outer_loop_within_2mi"]
                        if o.get("name") or o.get("desc")})
        L.append("!! Collin County Outer Loop alignment within ~2 mi"
                 + (f": {', '.join(names)}" if names
                    else f" ({len(ctx['outer_loop_within_2mi'])} segments)"))
    if ctx.get("nearby_developments"):
        L.append("")
        L.append(f"-- COMPETITIVE CONTEXT (within ~1 mi) " + "-" * 34)
        for d in ctx["nearby_developments"][:12]:
            name = (d.get("NAME") or d.get("Name") or d.get("PROJECT")
                    or d.get("DEVELOPMENT") or next(
                        (v for v in d.values() if isinstance(v, str)), "?"))
            L.append(f"  - {name}")

    L.append("")
    L.append("-- NET DEVELOPABLE AREA " + "-" * 48)
    y = r["yield"]
    L.append(f"  Gross                                    {y['gross_acres']:>9.2f} ac")
    for d in y["deductions"]:
        L.append(f"  less {d['item']:<38} {-d['acres']:>9.2f} ac")
    L.append(f"  {'':<43}{'':->9}")
    L.append(f"  NET DEVELOPABLE                          {y['net_developable_acres']:>9.2f} ac"
             f"   ({y['efficiency_pct']}% efficiency)")
    L.append(f"  Indicative units @ {y['density_units_per_acre']}/ac            "
             f"{y['indicative_units']:>9} units")
    L.append(f"  NOTE: {y['caveat']}")

    L.append("")
    L.append("-- OPEN DILIGENCE (no public API answers these) " + "-" * 24)
    for i, item in enumerate(r["open_diligence"], 1):
        L.append(f"  {i}. {item}")
    L.append("=" * 72)
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--address")
    g.add_argument("--latlon", help="lat,lon")
    g.add_argument("--prop-id", type=int, help="CAD property id")
    ap.add_argument("--open-space-pct", type=float, default=15.0)
    ap.add_argument("--row-pct", type=float, default=22.0)
    ap.add_argument("--stream-buffer-ft", type=float, default=50.0)
    ap.add_argument("--max-slope-pct", type=float, default=15.0)
    ap.add_argument("--density", type=float, default=2.5)
    ap.add_argument("--json", help="also write full JSON here")
    args = ap.parse_args()

    r = analyse(args)
    print(render(r))
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(r, fh, indent=2, default=str)
        print(f"\n[JSON written to {args.json}]")
    return 1 if "error" in r else 0


if __name__ == "__main__":
    sys.exit(main())

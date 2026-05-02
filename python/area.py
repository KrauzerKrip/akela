import argparse
import os
import json
import gzip
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import matplotlib.patches as mpatches
import matplotlib.lines as mlines
from matplotlib.collections import PolyCollection, LineCollection
from matplotlib.path import Path as MplPath
from matplotlib import patheffects
from PIL import Image, ImageEnhance


def _filter_candidates_min_sep_screen(ax, candidates, min_sep_px):
    """Drop candidates whose label anchor falls within min_sep_px of an earlier keeper.

    Uses screen (pixel) distance — unlike bbox overlap this matches how viewers perceive
    collisions and avoids rejecting almost everything when arc-length spacing follows a
    winding contour (many candidates stack close in x/y despite large contour spacing).
    """
    if min_sep_px <= 0:
        return list(candidates)

    cell = max(min_sep_px * 0.5, 24.0)
    grid = {}
    min_r2 = float(min_sep_px) ** 2
    filtered = []

    def neighbors_conflict(sx, sy):
        ix = int(sx // cell)
        iy = int(sy // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ox, oy in grid.get((ix + dx, iy + dy), ()):
                    dxp = sx - ox
                    dyp = sy - oy
                    if dxp * dxp + dyp * dyp < min_r2:
                        return True
        return False

    def remember(sx, sy):
        ix = int(sx // cell)
        iy = int(sy // cell)
        grid.setdefault((ix, iy), []).append((sx, sy))

    for item in candidates:
        data_xy, _, _ = item
        sx, sy = ax.transData.transform((float(data_xy[0]), float(data_xy[1])))
        if neighbors_conflict(sx, sy):
            continue
        remember(sx, sy)
        filtered.append(item)
    return filtered


def _contour_ring_centroid_data(verts):
    """Centroid of a closed 2D ring in data coordinates (verts from contour Path)."""
    v = np.asarray(verts, dtype=float)
    if len(v) < 3:
        return np.mean(v, axis=0)
    if np.allclose(v[0], v[-1]):
        v = v[:-1]
    if len(v) < 3:
        return np.mean(v, axis=0)
    x, y = v[:, 0], v[:, 1]
    x2 = np.concatenate([x, x[:1]])
    y2 = np.concatenate([y, y[:1]])
    cross = x2[:-1] * y2[1:] - x2[1:] * y2[:-1]
    area = 0.5 * np.sum(cross)
    if abs(area) < 1e-18:
        return np.mean(v, axis=0)
    cx = np.sum((x2[:-1] + x2[1:]) * cross) / (6.0 * area)
    cy = np.sum((y2[:-1] + y2[1:]) * cross) / (6.0 * area)
    return np.array([cx, cy])


def add_dense_contour_labels(ax, cs, fmt='%1.0fm', color='white', fontsize=16,
                             spacing_px=280, min_segment_px=50, zorder=10,
                             horizontal_only=False,
                             suppress_overlapping_labels=True,
                             overlap_min_sep_px=None,
                             overlap_margin_px=6):
    """Place elevation text along contours at regular spacing in screen pixels.

    spacing_px is arc distance along the contour in display pixels (not map meters): larger
    values yield fewer labels per line.

    Matplotlib's clabel adds at most one label per connected contour segment and
    skips segments shorter than ~10× the label width in pixels, which yields very
    few labels on high-resolution tactical crops despite dense contour geometry.

    horizontal_only: if True, labels use rotation=0 instead of aligning to the contour.

    Closed rings (hilltops, sinks) often have a short perimeter in screen pixels; those were
    skipped by min_segment_px alone — one label is placed at the ring centroid in that case.

    suppress_overlapping_labels: greedily drop later candidates whose anchor lies within
    overlap_min_sep_px screen pixels of an earlier keeper (approximates label+stroke width).

    overlap_min_sep_px: default derived from fontsize + overlap_margin_px when None.
    """
    spacing_px = max(40.0, float(spacing_px))

    outline = [
        patheffects.Stroke(linewidth=4.0, foreground='black'),
        patheffects.Normal(),
    ]
    trans = cs.get_transform()
    inv_data = ax.transData.inverted()

    def label_text_for_level(level):
        if isinstance(fmt, str):
            return fmt % level
        if callable(getattr(fmt, 'format_ticks', None)):
            return fmt.format_ticks([level])[-1]
        if callable(fmt):
            return fmt(level)
        return str(level)

    def place_label(data_xy, rotation, level):
        txt = label_text_for_level(level)
        t_art = ax.text(
            data_xy[0], data_xy[1], txt,
            ha='center', va='center',
            rotation=rotation,
            fontsize=fontsize,
            color=color,
            zorder=zorder,
            clip_on=True,
        )
        t_art.set_path_effects(outline)

    candidates = []

    for icon, lev in enumerate(cs.levels):
        path = cs.get_paths()[icon]
        for subpath in path._iter_connected_components():
            verts = np.asarray(subpath.vertices, dtype=float)
            if len(verts) < 2:
                continue
            xy_screen = trans.transform(verts)
            dxy = np.diff(xy_screen[:, 0]), np.diff(xy_screen[:, 1])
            ds = np.hypot(dxy[0], dxy[1])
            if not np.any(ds > 0):
                continue
            cumlen = np.concatenate([[0.0], np.cumsum(ds)])
            total_px = cumlen[-1]

            codes = subpath.codes
            closed_ring = (
                codes is not None
                and len(codes) == len(verts)
                and len(codes) > 0
                and codes[-1] == MplPath.CLOSEPOLY)
            if not closed_ring and len(verts) >= 3:
                closed_ring = np.allclose(
                    verts[0], verts[-1], rtol=0.0, atol=5.0)

            chord_px = float(np.linalg.norm(xy_screen[0] - xy_screen[-1]))
            small_screen_loop = (
                len(verts) >= 4
                and chord_px <= 36.0
                and total_px + 1e-6 >= 2.2 * chord_px)

            # Tiny loops (hilltops / sinks): perimeter is short in px so they failed the old
            # min_segment_px gate; matplotlib does not always emit CLOSEPOLY / duplicate ends.
            if total_px < min_segment_px:
                if closed_ring or small_screen_loop:
                    candidates.append(
                        (_contour_ring_centroid_data(verts), 0.0, lev))
                continue

            starts = np.arange(spacing_px * 0.5, total_px, spacing_px, dtype=float)
            if len(starts) == 0:
                starts = np.array([total_px * 0.5])

            for dist in starts:
                i = int(np.searchsorted(cumlen, dist, side='right') - 1)
                i = max(0, min(i, len(cumlen) - 2))
                span = cumlen[i + 1] - cumlen[i]
                if span <= 1e-9:
                    continue
                t = (dist - cumlen[i]) / span
                sx = xy_screen[i, 0] * (1 - t) + xy_screen[i + 1, 0] * t
                sy = xy_screen[i, 1] * (1 - t) + xy_screen[i + 1, 1] * t
                if horizontal_only:
                    rotation = 0.0
                else:
                    dx = xy_screen[i + 1, 0] - xy_screen[i, 0]
                    dy = xy_screen[i + 1, 1] - xy_screen[i, 1]
                    rotation = np.rad2deg(np.arctan2(dy, dx))
                    rotation = (rotation + 90) % 180 - 90

                data_xy = inv_data.transform((sx, sy))
                candidates.append((data_xy, rotation, lev))

    if suppress_overlapping_labels and candidates:
        sep = overlap_min_sep_px
        if sep is None:
            sep = max(52.0, float(fontsize) * 3.4 + float(overlap_margin_px))
        candidates = _filter_candidates_min_sep_screen(ax, candidates, sep)

    for data_xy, rotation, lev in candidates:
        place_label(data_xy, rotation, lev)


def add_features(ax, min_x, max_x, min_y, max_y, data_dir):
    def check_bbox(pts):
        if not pts or not isinstance(pts, list): return False
        if isinstance(pts[0], (int, float)):
            return min_x <= pts[0] <= max_x and min_y <= pts[1] <= max_y
        if isinstance(pts[0], list) and isinstance(pts[0][0], (int, float)):
            xs, ys = zip(*pts)
            return not (min(xs) > max_x or max(xs) < min_x or min(ys) > max_y or max(ys) < min_y)
        for sub in pts:
            if check_bbox(sub): return True
        return False

    def load_gz(filepath):
        if not os.path.exists(filepath): return []
        print(f"  > Loading {os.path.basename(filepath)}...")
        with gzip.open(filepath, 'rt') as f:
            return json.load(f)

    # 1. Forests
    forest_data = load_gz(os.path.join(data_dir, 'forest.geojson.gz'))
    forest_polys = []
    for f in forest_data:
        geom = f.get('geometry', {})
        coords = geom.get('coordinates', [])
        if check_bbox(coords):
            if geom.get('type') == 'Polygon':
                forest_polys.append(coords[0])
            elif geom.get('type') == 'MultiPolygon':
                for p in coords: forest_polys.append(p[0])
    if forest_polys:
        ax.add_collection(PolyCollection(forest_polys, facecolors='forestgreen', alpha=0.35, edgecolors='none', zorder=3))
        
    # 2. Roads - All styled Cyan for highly saturated AI visibility
    road_files = [
        ('roads/main_road.geojson.gz', 'cyan', 3.0, '-'),
        ('roads/main_road-bridge.geojson.gz', 'cyan', 3.0, '-'),
        ('roads/road.geojson.gz', 'cyan', 2.0, '-'),
        ('roads/road-bridge.geojson.gz', 'cyan', 2.0, '-'),
        ('roads/track.geojson.gz', 'cyan', 1.0, '--'),
        ('roads/track-bridge.geojson.gz', 'cyan', 1.0, '--'),
    ]
    for rfile, color, lw, ls in road_files:
        rdata = load_gz(os.path.join(data_dir, rfile))
        lines = []
        for f in rdata:
            geom = f.get('geometry', {})
            coords = geom.get('coordinates', [])
            if check_bbox(coords):
                if geom.get('type') == 'LineString':
                    lines.append(coords)
                elif geom.get('type') == 'MultiLineString':
                    lines.extend(coords)
        if lines:
            ax.add_collection(LineCollection(lines, colors=color, linewidths=lw, linestyles=ls, zorder=4))

    # 3. Houses / Buildings - Forced Bright Red for high locking contrast
    house_data = load_gz(os.path.join(data_dir, 'house.geojson.gz'))
    house_polys = []
    
    hx, hy = [], [] # Centroids for target anchoring
    for f in house_data:
        geom = f.get('geometry', {})
        coords = geom.get('coordinates', [])
        if check_bbox(coords):
            if geom.get('type') == 'Polygon':
                poly = coords[0]
                house_polys.append(poly)
                xs, ys = zip(*poly)
                hx.append(sum(xs)/len(xs))
                hy.append(sum(ys)/len(ys))
            elif geom.get('type') == 'MultiPolygon':
                for p in coords:
                    poly = p[0]
                    house_polys.append(poly)
                    xs, ys = zip(*poly)
                    hx.append(sum(xs)/len(xs))
                    hy.append(sum(ys)/len(ys))
                    
    if house_polys:
        # Override native colors for Bright Red
        red_fc = [1.0, 0.0, 0.0, 0.8]
        ax.add_collection(PolyCollection(house_polys, facecolors=red_fc, edgecolors='white', linewidths=0.5, zorder=5))
        # Add a tiny + at exactly the center coordinate of every single building
        ax.scatter(hx, hy, marker='+', color='white', s=15, zorder=6, linewidths=1.0)


def main():
    parser = argparse.ArgumentParser(description="Extract an area from Altis map and overlay contours.")
    subparsers = parser.add_subparsers(dest="mode", required=True)

    parser_ext = subparsers.add_parser("extract", help="Extract area and draw features/sat")
    parser_ext.add_argument("x1", type=float, help="Arma X coordinate of first point (in meters)")
    parser_ext.add_argument("y1", type=float, help="Arma Y coordinate of first point (in meters)")
    parser_ext.add_argument("x2", type=float, help="Arma X coordinate of second point (in meters)")
    parser_ext.add_argument("y2", type=float, help="Arma Y coordinate of second point (in meters)")
    parser_ext.add_argument("--out", type=str, default="area_overlay.png", help="Output image file")
    parser_ext.add_argument("--use-grid", action="store_true", help="Use tiles with grid overlay instead of raw satellite tiles")
    parser_ext.add_argument("--no-features", action="store_true", help="Do not draw geojson features")
    parser_ext.add_argument("--no-sat", action="store_true", help="Do not draw background satellite image (primitives only)")
    parser_ext.add_argument("--frame", action="store_true", help="Draw frame (legend, axis names, numbers)")
    parser_ext.add_argument("--grid", action="store_true", help="Draw grid")
    parser_ext.add_argument(
        "--horizontal-contour-labels",
        action="store_true",
        help="Keep contour elevation labels horizontal (ignore contour tangent)",
    )
    parser_ext.add_argument(
        "--no-suppress-overlapping-contour-labels",
        action="store_true",
        help="Allow contour labels to overlap for maximum density (debugging / preference)",
    )
    parser_ext.add_argument(
        "--contour-label-spacing-px",
        type=float,
        default=280,
        metavar="PX",
        help="Along-contour label spacing in screen pixels (larger = fewer labels per line)",
    )

    parser_frame = subparsers.add_parser("frame", help="Add frame/grid to an existing image")
    parser_frame.add_argument("image", type=str, help="Input image path")
    parser_frame.add_argument("x1", type=float, help="Arma X coordinate of first point (in meters)")
    parser_frame.add_argument("y1", type=float, help="Arma Y coordinate of first point (in meters)")
    parser_frame.add_argument("x2", type=float, help="Arma X coordinate of second point (in meters)")
    parser_frame.add_argument("y2", type=float, help="Arma Y coordinate of second point (in meters)")
    parser_frame.add_argument("--out", type=str, default="area_overlay.png", help="Output image file")
    parser_frame.add_argument("--frame", action="store_true", help="Draw frame (legend, axis names, numbers)")
    parser_frame.add_argument("--grid", action="store_true", help="Draw grid")
    parser_frame.add_argument("--no-features", action="store_true", help="Do not include features in legend")
    parser_frame.add_argument("--no-elevation", action="store_true", help="Do not include elevation contour in legend")

    args = parser.parse_args()

    max_map_size = 30720

    arma_min_x, arma_max_x = min(args.x1, args.x2), max(args.x1, args.x2)
    arma_min_y, arma_max_y = min(args.y1, args.y2), max(args.y1, args.y2)

    has_elevations = False

    if args.mode == "extract":
        arma_min_x = max(0, arma_min_x)
        arma_min_y = max(0, arma_min_y)
        arma_max_x = min(max_map_size, arma_max_x)
        arma_max_y = min(max_map_size, arma_max_y)

        print(f"Extracting area (Arma Coords): X=[{arma_min_x}, {arma_max_x}], Y=[{arma_min_y}, {arma_max_y}]")

        min_x = arma_min_x
        max_x = arma_max_x
        min_y = max_map_size - arma_max_y
        max_y = max_map_size - arma_min_y

        data_dir = '../.data/altis'
        sat_dir = os.path.join(data_dir, 'sat_grid' if args.use_grid else 'sat')
        dem_path = os.path.join(data_dir, 'dem.asc')
        
        tile_size = 7680
        col_start, col_end = int(min_x // tile_size), int(max_x // tile_size)
        row_start, row_end = int(min_y // tile_size), int(max_y // tile_size)

        crop_width = int(max_x - min_x)
        crop_height = int(max_y - min_y)
        
        if crop_width <= 0 or crop_height <= 0:
            print("Error: Area dimensions must be highly positive.")
            return

        sat_crop = None
        if not args.no_sat:
            print("Combining satellite tiles...")
            sat_crop = Image.new('RGB', (crop_width, crop_height))
            
            for c in range(col_start, col_end + 1):
                for r in range(row_start, row_end + 1):
                    tile_path = os.path.join(sat_dir, str(c), f"{r}.png")
                    if os.path.exists(tile_path):
                        tile_img = Image.open(tile_path).convert('RGB')
                        paste_x = int(c * tile_size - min_x)
                        paste_y = int(r * tile_size - min_y)
                        sat_crop.paste(tile_img, (paste_x, paste_y))
                    else:
                        print(f"Warning: Tile {tile_path} missing.")

            print("Enhancing contrast and brightness...")
            sat_crop = ImageEnhance.Contrast(sat_crop).enhance(1.4)
            sat_crop = ImageEnhance.Brightness(sat_crop).enhance(1.3)

        print("Loading DEM data for the bounding box...")
        if os.path.exists(dem_path):
            with open(dem_path, 'r') as f:
                headers = {}
                for _ in range(6):
                    parts = f.readline().split()
                    headers[parts[0]] = float(parts[1])
                    
            cellsize = headers['cellsize']
            nodata = headers['NODATA_value']
            
            r_start = max(0, int(min_y // cellsize))
            r_end = int(np.ceil(max_y / cellsize))
            c_start = max(0, int(min_x // cellsize))
            c_end = int(np.ceil(max_x / cellsize))
            
            skiprows = 6 + r_start
            max_rows = max(1, r_end - r_start)
            
            dem_crop = np.loadtxt(dem_path, skiprows=skiprows, max_rows=max_rows)
            dem_crop = np.atleast_2d(dem_crop)
            dem_crop = dem_crop[:, c_start:c_end]
            dem_crop[dem_crop == nodata] = np.nan
            dem_crop[dem_crop < -5000] = np.nan

            x_arr = np.arange(c_start, c_start + dem_crop.shape[1]) * cellsize
            pixel_y_arr = np.arange(r_start, r_start + dem_crop.shape[0]) * cellsize
            y_arr_arma = max_map_size - pixel_y_arr
            X, Y = np.meshgrid(x_arr, y_arr_arma)
            has_elevations = not np.all(np.isnan(dem_crop))
        else:
            dem_crop = None
            has_elevations = False

        print("Plotting overlay with contour and grids...")
        aspect = crop_height / crop_width
        fig_w = 14
        fig_h = 14 * aspect
        
        dpi = crop_width / fig_w
        if dpi > 300:
            dpi = 300
        elif dpi < 100:
            dpi = 100
            
        fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi)
        ax.set_xlim(arma_min_x, arma_max_x)
        ax.set_ylim(arma_min_y, arma_max_y)
        ax.set_aspect('equal')

        if not args.no_sat and sat_crop is not None:
            ax.imshow(sat_crop, extent=[arma_min_x, arma_max_x, arma_min_y, arma_max_y], zorder=0)
        else:
            ax.set_facecolor('#1a1a1c')
        
        if not args.no_features:
            print("Overlaying GeoJSON features (Roads, Forests, Houses)...")
            add_features(ax, arma_min_x, arma_max_x, arma_min_y, arma_max_y, data_dir)

        if not has_elevations:
            print("Note: No elevation data in this area.")
        else:
            max_ele = np.nanmax(dem_crop)
            min_ele = np.nanmin(dem_crop)
            if max_ele - min_ele > 1:
                step_m = 20
                lev0 = np.floor(min_ele / step_m) * step_m
                levels = np.arange(lev0, max_ele + step_m, step_m)
                if levels.size > 0:
                    cs = ax.contour(X, Y, dem_crop, levels=levels, colors='white', linewidths=1.0, alpha=0.9, zorder=2)
                    add_dense_contour_labels(
                        ax,
                        cs,
                        fmt='%1.0fm',
                        color='white',
                        fontsize=16,
                        spacing_px=args.contour_label_spacing_px,
                        zorder=10,
                        horizontal_only=args.horizontal_contour_labels,
                        suppress_overlapping_labels=(
                            not args.no_suppress_overlapping_contour_labels),
                    )
            else:
                print("Note: Very flat area, no contours drawn.")

    elif args.mode == "frame":
        print(f"Framing existing image: {args.image}")
        img = Image.open(args.image).convert('RGB')
        crop_width, crop_height = img.size
        
        aspect = crop_height / crop_width
        fig_w = 14
        fig_h = 14 * aspect
        
        dpi = crop_width / fig_w
        if dpi > 300:
            dpi = 300
        elif dpi < 100:
            dpi = 100
            
        fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi)
        ax.imshow(img, extent=[arma_min_x, arma_max_x, arma_min_y, arma_max_y], zorder=0)

    ax.set_xlim(arma_min_x, arma_max_x)
    ax.set_ylim(arma_min_y, arma_max_y)
    ax.set_aspect('equal')
    
    grid_step = 100 if (arma_max_x - arma_min_x) <= 2500 else 1000
    
    ax.xaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    ax.yaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    
    def format_coord(val, pos):
        return str(int(val // 100)).zfill(3)

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    
    if args.frame:
        ax.tick_params(axis='both', colors='white', labelsize=16, 
                       bottom=True, top=True, left=True, right=True,
                       labelbottom=True, labeltop=True, labelleft=True, labelright=True)
                       
        ax.set_xlabel("Easting (Arma XY)", color='white', fontsize=18, weight='bold', labelpad=15)
        ax.set_ylabel("Northing (Arma XY)", color='white', fontsize=18, weight='bold', labelpad=15)
        
        for spine in ax.spines.values():
            spine.set_edgecolor('white')
            spine.set_linewidth(2.0)
            spine.set_zorder(15)
    else:
        ax.tick_params(which='both', bottom=False, top=False, left=False, right=False, 
                       labelbottom=False, labeltop=False, labelleft=False, labelright=False)
        for spine in ax.spines.values():
            spine.set_visible(False)

    if args.grid:
        ax.grid(True, which='major', color='white', linestyle='-', linewidth=1.5, alpha=0.7, zorder=11)
    
    # ---------------------------------------------------------
    # Legend construction
    legend_elements = []
    if not args.no_features:
        legend_elements.extend([
            mpatches.Patch(facecolor=[1.0, 0.0, 0.0, 0.8], edgecolor='white', label='Building'),
            mlines.Line2D([0], [0], marker='+', color='w', markerfacecolor='w', markersize=8, linestyle='None', label='Building Center'),
            mlines.Line2D([0], [0], color='cyan', lw=2, label='Road / Track'),
            mpatches.Patch(facecolor='forestgreen', alpha=0.35, edgecolor='none', label='Forest / Brush')
        ])
    
    show_elevation_legend = has_elevations if args.mode == "extract" else (not getattr(args, 'no_elevation', False))
    if show_elevation_legend:
        legend_elements.append(mlines.Line2D([0], [0], color='white', lw=1.0, label='Elevation Contour (20m)'))
        
    legend_elements.append(mlines.Line2D([0], [0], color='white', lw=1.5, linestyle='-', alpha=0.7, label='Arma Coordinates Grid'))
    
    if args.frame and legend_elements:
        leg = ax.legend(handles=legend_elements, loc='upper left', bbox_to_anchor=(1.055, 1), facecolor='black', edgecolor='white', labelcolor='white', fontsize=14, framealpha=0.85)
        leg.set_zorder(20)
    # ---------------------------------------------------------

    fig.patch.set_facecolor('black')
    
    if args.frame:
        plt.tight_layout(pad=3.0)
        plt.savefig(args.out, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
    else:
        plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
        plt.savefig(args.out, bbox_inches='tight', pad_inches=0, facecolor=fig.get_facecolor())
        
    print(f"Extraction complete! Saved image to {args.out}")

if __name__ == "__main__":
    main()

import argparse
import os
import json
import gzip
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from matplotlib.collections import PolyCollection, LineCollection
from PIL import Image, ImageEnhance

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
    parser.add_argument("x1", type=float, help="Arma X coordinate of first point (in meters)")
    parser.add_argument("y1", type=float, help="Arma Y coordinate of first point (in meters)")
    parser.add_argument("x2", type=float, help="Arma X coordinate of second point (in meters)")
    parser.add_argument("y2", type=float, help="Arma Y coordinate of second point (in meters)")
    parser.add_argument("--out", type=str, default="area_overlay.png", help="Output image file")
    parser.add_argument("--use-grid", action="store_true", help="Use tiles with grid overlay instead of raw satellite tiles")
    parser.add_argument("--no-features", action="store_true", help="Do not draw geojson features")
    parser.add_argument("--no-sat", action="store_true", help="Do not draw background satellite image (primitives only)")
    args = parser.parse_args()

    max_map_size = 30720

    arma_min_x, arma_max_x = min(args.x1, args.x2), max(args.x1, args.x2)
    arma_min_y, arma_max_y = min(args.y1, args.y2), max(args.y1, args.y2)

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
    
    # Bottom layer: Background image or purely black/gray background
    if not args.no_sat and sat_crop is not None:
        ax.imshow(sat_crop, extent=[arma_min_x, arma_max_x, arma_min_y, arma_max_y], zorder=0)
    else:
        # Default space color when no satellite is enabled purely drawing primitives
        ax.set_facecolor('#1a1a1c')
    
    if not args.no_features:
        print("Overlaying GeoJSON features (Roads, Forests, Houses)...")
        add_features(ax, arma_min_x, arma_max_x, arma_min_y, arma_max_y, data_dir)

    if np.all(np.isnan(dem_crop)):
        print("Note: No elevation data in this area.")
    else:
        max_ele = np.nanmax(dem_crop)
        min_ele = np.nanmin(dem_crop)
        if max_ele - min_ele > 1:
            levels = np.arange(0, max_ele + 20, 20)
            if len(levels) > 0:
                # Contours slightly behind prominent structures or features like houses
                cs = ax.contour(X, Y, dem_crop, levels=levels, colors='white', linewidths=1.0, alpha=0.9, zorder=2)
                # Keep text high up to avoid getting fully hidden
                ax.clabel(cs, inline=True, fontsize=12, colors='white', fmt='%1.0fm', zorder=10)
        else:
            print("Note: Very flat area, no contours drawn.")

    ax.set_xlim(arma_min_x, arma_max_x)
    ax.set_ylim(arma_min_y, arma_max_y)
    
    grid_step = 100 if (arma_max_x - arma_min_x) <= 2500 else 1000
    
    ax.xaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    ax.yaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    
    def format_coord(val, pos):
        return str(int(val // 100)).zfill(3)

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    
    ax.tick_params(axis='both', colors='white', labelsize=16, 
                   bottom=True, top=True, left=True, right=True,
                   labelbottom=True, labeltop=True, labelleft=True, labelright=True)
                   
    ax.set_xlabel("Easting (Arma XY)", color='white', fontsize=18, weight='bold', labelpad=15)
    ax.set_ylabel("Northing (Arma XY)", color='white', fontsize=18, weight='bold', labelpad=15)
    
    for spine in ax.spines.values():
        spine.set_edgecolor('white')
        spine.set_linewidth(2.0)
        spine.set_zorder(15)

    # Put the Arma grid completely on top so labels/guidelines are never lost
    ax.grid(True, which='major', color='white', linestyle='-', linewidth=1.5, alpha=0.7, zorder=11)
    
    fig.patch.set_facecolor('black')
    
    plt.tight_layout(pad=3.0)
    plt.savefig(args.out, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
    print(f"Extraction complete! Saved image to {args.out}")

if __name__ == "__main__":
    main()

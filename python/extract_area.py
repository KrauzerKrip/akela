import argparse
import os
import json
import numpy as np
import matplotlib.pyplot as plt
from PIL import Image

def main():
    parser = argparse.ArgumentParser(description="Extract an area from Altis map and overlay contours.")
    parser.add_argument("x1", type=float, help="X coordinate of first point (in meters)")
    parser.add_argument("y1", type=float, help="Y coordinate of first point (in meters)")
    parser.add_argument("x2", type=float, help="X coordinate of second point (in meters)")
    parser.add_argument("y2", type=float, help="Y coordinate of second point (in meters)")
    parser.add_argument("--out", type=str, default="area_overlay.png", help="Output image file")
    parser.add_argument("--use-grid", action="store_true", help="Use tiles with grid overlay instead of raw satellite tiles")
    args = parser.parse_args()

    min_x, max_x = min(args.x1, args.x2), max(args.x1, args.x2)
    min_y, max_y = min(args.y1, args.y2), max(args.y1, args.y2)

    # Validate bounds
    max_map_size = 30720
    min_x = max(0, min_x)
    min_y = max(0, min_y)
    max_x = min(max_map_size, max_x)
    max_y = min(max_map_size, max_y)

    print(f"Extracting area: X=[{min_x}, {max_x}], Y=[{min_y}, {max_y}]")

    data_dir = '../.data/altis'
    sat_dir = os.path.join(data_dir, 'sat_grid' if args.use_grid else 'sat')
    dem_path = os.path.join(data_dir, 'dem.asc')
    
    # 1. Stitch Satellite Images
    tile_size = 7680
    col_start, col_end = int(min_x // tile_size), int(max_x // tile_size)
    row_start, row_end = int(min_y // tile_size), int(max_y // tile_size)

    crop_width = int(max_x - min_x)
    crop_height = int(max_y - min_y)
    
    if crop_width <= 0 or crop_height <= 0:
        print("Error: Area dimensions must be highly positive.")
        return

    sat_crop = Image.new('RGB', (crop_width, crop_height))
    
    print("Combining satellite tiles...")
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

    # 2. Read DEM and crop
    print("Loading DEM data for the bounding box...")
    with open(dem_path, 'r') as f:
        headers = {}
        for _ in range(6):
            parts = f.readline().split()
            headers[parts[0]] = float(parts[1])
            
    cellsize = headers['cellsize']
    nodata = headers['NODATA_value']
    
    # Crop bounds for DEM
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
    
    # Replace all remaining nodata values that might not specifically match due to float interpretation
    # -9999 or things extremely low usually indicate nodata in Arma
    dem_crop[dem_crop < -5000] = np.nan

    x_arr = np.arange(c_start, c_start + dem_crop.shape[1]) * cellsize
    y_arr = np.arange(r_start, r_start + dem_crop.shape[0]) * cellsize
    X, Y = np.meshgrid(x_arr, y_arr)

    # 3. Plot overlay
    print("Plotting overlay...")
    aspect = crop_height / crop_width
    fig_w = 12
    fig_h = 12 * aspect
    
    # Adjust DPI for output limits (capping around massive bounds)
    dpi = crop_width / fig_w
    if dpi > 300:
        dpi = 300
        
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi)
    
    ax.imshow(sat_crop, extent=[min_x, max_x, max_y, min_y])
    
    if np.all(np.isnan(dem_crop)):
        print("Note: No elevation data in this area.")
    else:
        max_ele = np.nanmax(dem_crop)
        min_ele = np.nanmin(dem_crop)
        # Avoid empty levels if elevation difference is too small
        if max_ele - min_ele > 1:
            levels = np.arange(0, max_ele + 20, 20)
            if len(levels) > 0:
                cs = ax.contour(X, Y, dem_crop, levels=levels, colors='black', linewidths=0.5, alpha=0.6)
                ax.clabel(cs, inline=True, fontsize=6)
        else:
            print("Note: Very flat area, no contours drawn.")

    ax.set_xlim(min_x, max_x)
    ax.set_ylim(max_y, min_y)
    ax.axis('off')
    
    plt.tight_layout(pad=0)
    plt.savefig(args.out, bbox_inches='tight', pad_inches=0)
    print(f"Extraction complete! Saved image to {args.out}")

if __name__ == "__main__":
    main()

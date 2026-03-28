import argparse
import os
import json
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from PIL import Image, ImageEnhance

def main():
    parser = argparse.ArgumentParser(description="Extract an area from Altis map and overlay contours.")
    parser.add_argument("x1", type=float, help="Arma X coordinate of first point (in meters)")
    parser.add_argument("y1", type=float, help="Arma Y coordinate of first point (in meters)")
    parser.add_argument("x2", type=float, help="Arma X coordinate of second point (in meters)")
    parser.add_argument("y2", type=float, help="Arma Y coordinate of second point (in meters)")
    parser.add_argument("--out", type=str, default="area_overlay.png", help="Output image file")
    parser.add_argument("--use-grid", action="store_true", help="Use tiles with grid overlay instead of raw satellite tiles")
    args = parser.parse_args()

    max_map_size = 30720

    # User inputs are Arma coordinates where Y=0 is bottom and Y=30720 is top
    arma_min_x, arma_max_x = min(args.x1, args.x2), max(args.x1, args.x2)
    arma_min_y, arma_max_y = min(args.y1, args.y2), max(args.y1, args.y2)

    arma_min_x = max(0, arma_min_x)
    arma_min_y = max(0, arma_min_y)
    arma_max_x = min(max_map_size, arma_max_x)
    arma_max_y = min(max_map_size, arma_max_y)

    print(f"Extracting area (Arma Coords): X=[{arma_min_x}, {arma_max_x}], Y=[{arma_min_y}, {arma_max_y}]")

    # Map Arma coordinates to Image (Pixel) coordinates
    # X matches directly. Y is inverted (Pixel Y=0 is top, Arma Y=30720 is top)
    min_x = arma_min_x
    max_x = arma_max_x
    min_y = max_map_size - arma_max_y
    max_y = max_map_size - arma_min_y

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

    print("Enhancing contrast and brightness (optimizing for LLM visibility)...")
    sat_crop = ImageEnhance.Contrast(sat_crop).enhance(1.4)
    sat_crop = ImageEnhance.Brightness(sat_crop).enhance(1.3)

    # 2. Read DEM and crop
    print("Loading DEM data for the bounding box...")
    with open(dem_path, 'r') as f:
        headers = {}
        for _ in range(6):
            parts = f.readline().split()
            headers[parts[0]] = float(parts[1])
            
    cellsize = headers['cellsize']
    nodata = headers['NODATA_value']
    
    # Crop bounds for DEM (Pixel indices)
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

    # Map arrays to Arma coordinates
    # x_arr matches pixel x
    x_arr = np.arange(c_start, c_start + dem_crop.shape[1]) * cellsize
    # pixel_y_arr = top to bottom
    pixel_y_arr = np.arange(r_start, r_start + dem_crop.shape[0]) * cellsize
    # Convert pixel_y_arr to arma_y
    y_arr_arma = max_map_size - pixel_y_arr
    
    X, Y = np.meshgrid(x_arr, y_arr_arma)

    # 3. Plot overlay
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
    
    # Now we plot cleanly in standard Cartesian (Arma format)
    # the image top edge is arma_max_y, bottom edge is arma_min_y
    ax.imshow(sat_crop, extent=[arma_min_x, arma_max_x, arma_min_y, arma_max_y])
    
    if np.all(np.isnan(dem_crop)):
        print("Note: No elevation data in this area.")
    else:
        max_ele = np.nanmax(dem_crop)
        min_ele = np.nanmin(dem_crop)
        if max_ele - min_ele > 1:
            levels = np.arange(0, max_ele + 20, 20)
            if len(levels) > 0:
                # Bright white contours, thick lines for LLM readability
                cs = ax.contour(X, Y, dem_crop, levels=levels, colors='white', linewidths=1.5, alpha=0.9)
                ax.clabel(cs, inline=True, fontsize=12, colors='white', fmt='%1.0fm')
        else:
            print("Note: Very flat area, no contours drawn.")

    ax.set_xlim(arma_min_x, arma_max_x)
    ax.set_ylim(arma_min_y, arma_max_y)
    
    # Grid step: 100m for micro regions, 1000m for regional maps
    grid_step = 100 if (arma_max_x - arma_min_x) <= 2500 else 1000
    
    ax.xaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    ax.yaxis.set_major_locator(ticker.MultipleLocator(grid_step))
    
    def format_coord(val, pos):
        # Format "000" for grids in meters
        return str(int(val // 100)).zfill(3)

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_coord))
    
    # Ultra-readable grid settings
    ax.tick_params(axis='both', colors='white', labelsize=16, 
                   bottom=True, top=True, left=True, right=True,
                   labelbottom=True, labeltop=True, labelleft=True, labelright=True)
                   
    ax.set_xlabel("Easting (Arma XYZ)", color='white', fontsize=18, weight='bold', labelpad=15)
    ax.set_ylabel("Northing (Arma XYZ)", color='white', fontsize=18, weight='bold', labelpad=15)
    
    for spine in ax.spines.values():
        spine.set_edgecolor('white')
        spine.set_linewidth(2.0)

    # Thick, slightly transparent white grid to clearly distinguish square blocks
    ax.grid(True, which='major', color='white', linestyle='-', linewidth=1.5, alpha=0.7)
    
    # Set plot bounds facecolor black so text is highly visible
    fig.patch.set_facecolor('black')
    
    plt.tight_layout(pad=3.0)
    plt.savefig(args.out, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
    print(f"Extraction complete! Saved image to {args.out}")

if __name__ == "__main__":
    main()

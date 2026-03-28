import os
import json
from PIL import Image, ImageDraw, ImageFont

data_dir = '../.data/altis'
sat_dir = os.path.join(data_dir, 'sat')
out_dir = os.path.join(data_dir, 'sat_grid')
meta_path = os.path.join(data_dir, 'meta.json')

if not os.path.exists(out_dir):
    os.makedirs(out_dir)

with open(meta_path, 'r') as f:
    meta = json.load(f)

grid_offset_y = meta['gridOffsetY'] # 30720.0
# The step is -100 for minor and -1000 for major
# We'll use 1000m for major lines (thick), 100m for minor lines (thin)

tile_size = 7680
cols_dirs = sorted([d for d in os.listdir(sat_dir) if os.path.isdir(os.path.join(sat_dir, d))], key=int)

for c in cols_dirs:
    col_out_dir = os.path.join(out_dir, c)
    if not os.path.exists(col_out_dir):
        os.makedirs(col_out_dir)
        
    tiles = sorted([f for f in os.listdir(os.path.join(sat_dir, c)) if f.endswith('.png')], key=lambda x: int(x.split('.')[0]))
    for row_img in tiles:
        r = int(row_img.split('.')[0])
        img_path = os.path.join(sat_dir, c, row_img)
        print(f"Processing tile column {c}, row {r}...")
        
        img = Image.open(img_path).convert("RGBA")
        draw = ImageDraw.Draw(img)
        
        # Absolute coordinates of top-left pixel
        start_x = int(c) * tile_size
        start_y = int(r) * tile_size
        
        # Draw vertical lines (X)
        for i in range(tile_size):
            abs_x = start_x + i
            if abs_x % 1000 == 0:
                # Major line
                draw.line([(i, 0), (i, tile_size)], fill=(255, 0, 0, 180), width=4)
                # Label X
                label = str(abs_x // 1000).zfill(2)
                draw.text((i + 5, 5), label, fill=(255, 0, 0, 255))
            elif abs_x % 100 == 0:
                # Minor line
                draw.line([(i, 0), (i, tile_size)], fill=(255, 255, 255, 100), width=1)
                
        # Draw horizontal lines (Y)
        for j in range(tile_size):
            abs_y = start_y + j
            if abs_y % 1000 == 0:
                # Major line
                draw.line([(0, j), (tile_size, j)], fill=(255, 0, 0, 180), width=4)
                # Label Y
                y_coord = int(grid_offset_y - abs_y)
                label = str(y_coord // 1000).zfill(2)
                draw.text((5, j + 5), label, fill=(255, 0, 0, 255))
            elif abs_y % 100 == 0:
                # Minor line
                draw.line([(0, j), (tile_size, j)], fill=(255, 255, 255, 100), width=1)

        out_img_path = os.path.join(col_out_dir, row_img)
        img.save(out_img_path)
        print(f"Saved {out_img_path}")

print("Completed grid overlays.")

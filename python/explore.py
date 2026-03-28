import os
from PIL import Image

data_dir = '../.data/altis'
sat_dir = os.path.join(data_dir, 'sat')

# check sat tiles
if os.path.exists(sat_dir):
    cols = sorted([d for d in os.listdir(sat_dir) if os.path.isdir(os.path.join(sat_dir, d))], key=int)
    print(f'Sat cols: {cols}')
    for c in cols:
        col_path = os.path.join(sat_dir, c)
        rows = sorted([f for f in os.listdir(col_path) if f.endswith('.png')], key=lambda x: int(x.split('.')[0]))
        if rows:
            img = Image.open(os.path.join(col_path, rows[0]))
            print(f'Col {c} has {len(rows)} rows. Image {c}/{rows[0]} size: {img.size}')
            break

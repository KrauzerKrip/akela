import os
import numpy as np
import matplotlib.pyplot as plt

data_dir = '../.data/altis'
dem_path = os.path.join(data_dir, 'dem.asc')
out_path = os.path.join(data_dir, 'contours.svg')

print("Reading DEM data...")
with open(dem_path, 'r') as f:
    headers = {}
    for _ in range(6):
        parts = f.readline().split()
        headers[parts[0]] = float(parts[1])

print("Header parsed:", headers)
nx = int(headers['ncols'])
ny = int(headers['nrows'])
cellsize = headers['cellsize']
nodata = headers['NODATA_value']

print("Loading data values (this may take a minute)...")
# Since the file is reasonably sized, we can read the entire thing 
# skipping the first 6 lines header.
data = np.loadtxt(dem_path, skiprows=6)

print(f"Data shape: {data.shape}")
# Ensure it matches expected dimensions
if data.shape[0] != ny:
    print(f"Warning: Expected {ny} rows, found {data.shape[0]}.")

# Filter nodata
data[data == nodata] = np.nan

# Define axes
x = np.arange(nx) * cellsize
# For Y axis, if origin is top-left, the map goes from Y=0 at top to Y=max at bottom.
y = np.arange(ny) * cellsize
# To match top-left origin when plotted, y array from 0 to max, and set plt.gca().invert_yaxis()

print("Generating contour map...")
# We use a smaller size if saving to SVG to avoid extreme file size, or SVG can scale infinitely.
# For 16M points, generating a highly detailed SVG might be huge. A high-res PNG is safer.
out_path_png = os.path.join(data_dir, 'contours.png')
fig, ax = plt.subplots(figsize=(24, 24))

# Contour every 20 meters
levels = np.arange(0, np.nanmax(data) + 20, 20)
print(f"Contour levels: {levels}")

# Draw contours
cs = ax.contour(x, y, data, levels=levels, colors='black', linewidths=0.5, alpha=0.6)
ax.invert_yaxis()  # Arma maps origin is top-left
ax.set_aspect('equal')
ax.axis('off')

# Optionally add labels to contours
ax.clabel(cs, inline=True, fontsize=6)

plt.tight_layout()
print(f"Saving high-res SVG image to {out_path}...")
plt.savefig(out_path, dpi=300, format='svg', bbox_inches='tight')
print(f"Saving high-res PNG image to {out_path_png}...")
plt.savefig(out_path_png, dpi=300, bbox_inches='tight')
print("Completed contour mapping.")

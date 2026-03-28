import os
import gzip
import shutil
import glob

def main():
    data_dir = '../.data/altis'
    print(f"Unpacking geojson.gz files in {data_dir}...")
    
    # Find all .gz files in altis and its subdirectories
    gz_files = glob.glob(os.path.join(data_dir, '**', '*.geojson.gz'), recursive=True)
    
    if not gz_files:
        print("No .geojson.gz files found.")
        return
        
    for gz_path in gz_files:
        out_path = gz_path[:-3] # remove .gz extension
        if not os.path.exists(out_path):
            print(f"Unpacking {os.path.basename(gz_path)} -> {os.path.basename(out_path)}")
            with gzip.open(gz_path, 'rb') as f_in:
                with open(out_path, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
        else:
            print(f"Skipping {os.path.basename(gz_path)}, already unpacked.")

    print("Finished unpacking.")

if __name__ == "__main__":
    main()

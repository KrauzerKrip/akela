def my_function(my, arguments):
    return ["awesome", 42, True, (1, 2)]

def my_function_2(my, arguments):
    return ["awesome!!!", 43, True, (1, 2)]

import urllib.request
import urllib.error

def get_localhost_data():
    url = "http://localhost:3000"
    try:
        with urllib.request.urlopen(url) as response:
            # Reads the raw bytes and decodes them into a string
            return response.read().decode('utf-8')
    except urllib.error.URLError as e:
        return f"Connection Error: {e.reason}"
    except Exception as e:
        return f"An unexpected error occurred: {e}"

from uuid import uuid4
from queue import Queue

requests = {}
request_queue = Queue(maxsize=15)

def my_function(my, arguments):
    return ["awesome", 42, True, (1, 2)]

def my_function_2(group):
    return [group]

def respond(request_id, response):
    # e.g. 
    # "50f5db42-bbaa-4987-a89c-31005600ead3",
    # [
    #   ["groups", "BLUFOR", ["Alpha 1-1", "Alpha 1-2"]],
    #   ["units", "Alpha 1-1", ["Alpha 1-1:1", "Alpha 1-1:2"]],
    #   ["getUnitLoadout", "Alpha 1-1:1", [...]]
    # ]
    global requests
    req = requests.pop(request_id)
    req["callback"](response)

def pollRequest():
    # ["50f5db42-bbaa-4987-a89c-31005600ead3", [["groups", "BLUFOR"], ["units", "Alpha 1-1"], ["getUnitLoadout", "Alpha 1-1:1"]]]
    global requests, request_queue
    req_id = request_queue.get()
    req = requests[req_id]
    return req

import urllib.request
import urllib.error

def request(req, callback):
    global requests, request_queue
    req_id = str(uuid4())
    requests[req_id] = {"request": req, "callback": callback}
    request_queue.put(req_id)

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

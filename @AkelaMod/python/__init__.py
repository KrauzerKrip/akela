import codecs
from uuid import uuid4
from queue import Queue, Empty

requests = {}
request_queue = Queue(maxsize=15)


def log_to_server(message):
    """Helper to send a message to the backend server."""
    try:
        import json
        import urllib.request
        url = "http://localhost:3000/log"
        data = json.dumps({"message": str(message)}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as response:
            pass
    except Exception:
        pass
    
def my_function():
    log_to_server("TEST!")
    return ["awesome", 42, True, (1, 2)]

def my_function_2(group):
    return [group]

def respond(request_id, response):
    # e.g. 
    # "50f5db42-bbaa-4987-a89c-31005600ead3",
    # [
    #   ["groups", "BLUFOR", {"0:289": "Alpha 1-1", "0:290": "Alpha 1-2"}],
    #   ["units", "0:289", ["0:1779946": "Alpha 1-1:1", "0:1873948": "Alpha 1-1:2"]],
    #   ["getUnitLoadout", "0:1779946", [...]]
    # ]
    log_to_server("RESPOND " + request_id + " " + str(response))
    global requests
    req = requests.pop(request_id)
    req["callback"](response)

def pollRequest():
    # ["50f5db42-bbaa-4987-a89c-31005600ead3", [["groups", "BLUFOR"], ["units", "0:289"], ["getUnitLoadout", "0:1779946"]]]
    global requests, request_queue
    try:
        req_id = request_queue.get(block=False)
        log_to_server("req id: " + req_id + " " + str(requests[req_id]["request"]))
        return [req_id, requests[req_id]["request"]]
    except Empty:
        return []

def test_ammo_chain(*args):
    # Step 1: Request all BLUFOR groups
    log_to_server("Pythia: Starting ammo test, requesting BLUFOR groups...")
    request([["groups", "BLUFOR"]], _on_groups_received)
    return "Test started! Check Python console for results."

def _on_groups_received(response):
    # Response structure: [ ["groups", "BLUFOR", {"0:289": "Alpha 1-1", ...}] ]
    groups_dict = dict(response[0][2])
    
    if not groups_dict:
        log_to_server("Pythia: No BLUFOR groups found.")
        return
        
    # Grab the first group's netId (the dictionary key)
    first_group_netid = list(groups_dict.keys())[0]
    group_name = groups_dict[first_group_netid]
    log_to_server(f"Pythia: Found first group -> {first_group_netid} ({group_name})")
    
    # Step 2: Request units for this specific group
    request([["units", first_group_netid]], _on_units_received)

def _on_units_received(response):
    # Response structure: [ ["units", "0:289", {"0:1779946": "Alpha 1-1:1", ...}] ]
    units_dict = dict(response[0][2])
    
    if not units_dict or "error" in units_dict:
        log_to_server("Pythia: No units found in group.")
        return
        
    # Grab the first unit's netId
    first_unit_netid = list(units_dict.keys())[0]
    unit_name = units_dict[first_unit_netid]
    log_to_server(f"Pythia: Found first unit -> {first_unit_netid} ({unit_name})")
    
    # Step 3: Request loadout/ammo for this specific unit
    request([["getUnitLoadout", first_unit_netid]], _on_loadout_received)

def _on_loadout_received(response):
    loadout = response[0][2]
    if not loadout:
        log_to_server("Pythia: Unit has no loadout.")
        return
        
    try:
        primary_weapon = loadout[0]
        if primary_weapon and len(primary_weapon) > 4:
            loaded_mag = primary_weapon[4] 
            # This is the "Print" to Arma
            log_to_server(f"SUCCESS! Mag: {loaded_mag[0]} | Count: {loaded_mag[1]}")
        else:
            log_to_server("Pythia: No primary weapon found.")
    except Exception as e:
        log_to_server(f"Pythia Error: {str(e)}")

import urllib.request
import urllib.error

def request(req, callback):
    global requests, request_queue
    req_id = str(uuid4())
    requests[req_id] = {"request": req, "callback": callback}
    request_queue.put(req_id)

def set_combat_mode(group_net_id, mode, callback=None):
    if callback is None:
        callback = lambda response: log_to_server(f"setCombatMode response: {response}")
    request([["setCombatMode", [group_net_id, mode]]], callback)

def set_combat_behaviour(net_id, behaviour, callback=None):
    if callback is None:
        callback = lambda response: log_to_server(f"setCombatBehaviour response: {response}")
    request([["setCombatBehaviour", [net_id, behaviour]]], callback)

def set_group_id(group_net_id, name, callback=None):
    if callback is None:
        callback = lambda response: log_to_server(f"setGroupId response: {response}")
    request([["setGroupId", [group_net_id, name]]], callback)

def set_formation(group_net_id, formation, callback=None):
    if callback is None:
        callback = lambda response: log_to_server(f"setFormation response: {response}")
    request([["setFormation", [group_net_id, formation]]], callback)

def command_move(unit_net_ids, position, callback=None):
    if callback is None:
        callback = lambda response: log_to_server(f"commandMove response: {response}")
    if isinstance(unit_net_ids, str):
        unit_net_ids = [unit_net_ids]
    request([["commandMove", [unit_net_ids, position]]], callback)

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

import threading
import time
import json

def server_poll_loop():
    while True:
        try:
            url = "http://localhost:3000/poll"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=2) as response:
                if response.getcode() == 200:
                    data = response.read().decode('utf-8').strip()
                    if data:
                        command_json = json.loads(data)
                        server_req_id = command_json.get("id")
                        commands = command_json.get("commands", [])
                        
                        if commands:
                            completed_event = threading.Event()
                            
                            def make_callback(sid, event):
                                def callback(resp):
                                    try:
                                        resp_url = "http://localhost:3000/respond"
                                        resp_data = json.dumps({"id": sid, "response": resp}).encode('utf-8')
                                        r = urllib.request.Request(resp_url, method="POST", data=resp_data, headers={"Content-Type": "application/json"})
                                        urllib.request.urlopen(r, timeout=2)
                                    except Exception as e:
                                        log_to_server(f"Respond error: {e}")
                                    finally:
                                        event.set()
                                return callback
                            
                            request(commands, make_callback(server_req_id, completed_event))
                            
                            # Block polling until the response comes back from SQF
                            completed_event.wait()
        except Exception:
            pass
            
        time.sleep(0.5)

if "poll_thread" not in globals():
    poll_thread = threading.Thread(target=server_poll_loop, daemon=True)
    poll_thread.start()

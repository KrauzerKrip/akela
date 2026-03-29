# Arma 3 - Python - Server Request API Documentation

This document describes the structure and format of responses returned for each supported Arma request type when executed from the backend through Python (via the `poll`/`respond` mechanism).

## General Response Payload Structure

A response to any single request query comes in an array containing three elements:
`[queryType: string, queryArg: any, queryResult: any]`

Because a client can send multiple queries in a single HTTP polling request, the full response sent back to the server is an array of these results:
```json
[
  ["query_1", "arg_1", <result_1>],
  ["query_2", "arg_2", <result_2>]
]
```

---

## Supported Requests & Return Formats

### 1. `log`
*   **Description**: Prints a message to the in-game systemic chat and logs it to the `.rpt` file.
*   **Query Argument**: `string` (The message to log)
*   **Returns (`queryResult`)**: `boolean` (`true`)
*   **Example Response**:
    ```json
    ["log", "Hello Arma!", true]
    ```

### 2. `groups`
*   **Description**: Retrieves a list of all groups belonging to a specific side.
*   **Query Argument**: `string` (Side name: "BLUFOR", "OPFOR", "INDEPENDENT", "CIVILIAN", "WEST", "EAST", "GUER", "CIV")
*   **Returns (`queryResult`)**: `list[list[string, string]]` (A list of `[netId, groupId]` pairs for each matching group)
*   **Example Response**:
    ```json
    [
      "groups", 
      "BLUFOR", 
      [
        ["0:289", "Alpha 1-1"], 
        ["0:290", "Alpha 1-2"]
      ]
    ]
    ```

### 3. `units`
*   **Description**: Retrieves a list of all units within a specified group.
*   **Query Argument**: `string` (Group `netId`)
*   **Returns (`queryResult`)**: `list[list[string, string]]` (A list of `[netId, name]` pairs for each unit). If the group is not found or is null, returns `[["error", "Group not found or is null"]]`.
*   **Example Response**:
    ```json
    [
      "units", 
      "0:289", 
      [
        ["0:1779946", "B_Soldier_F"], 
        ["0:1873948", "B_Soldier_AR_F"]
      ]
    ]
    ```

### 4. `getUnitLoadout`
*   **Description**: Retrieves the complete loadout of a specific unit.
*   **Query Argument**: `string` (Unit `netId`)
*   **Returns (`queryResult`)**: `list` (A complex array corresponding to the native Arma 3 SQF `getUnitLoadout` return structure). If the unit does not exist or has died, returns an empty array `[]`.
*   **Example Response**:
    ```json
    [
      "getUnitLoadout", 
      "0:1779946", 
      [
        ["arifle_MXC_Holo_pointer_F", "", "acc_pointer_IR", "optic_Holosight", ["30Rnd_65x39_caseless_mag", 30], [], ""],
        ["launch_B_Titan_short_F", "", "", "", ["Titan_AT", 1], [], ""],
        ["hgun_P07_F", "", "", "", ["16Rnd_9x21_Mag", 16], [], ""],
        ["U_B_CombatUniform_mcam", [["FirstAidKit", 1], ["30Rnd_65x39_caseless_mag", 2, 30], ["Chemlight_green", 1, 1]]],
        ["V_PlateCarrier1_rgr", [["30Rnd_65x39_caseless_mag", 3, 30], ["16Rnd_9x21_Mag", 2, 16], ["SmokeShell", 1 ,1]]],
        ["B_AssaultPack_mcamo_AT", [["Titan_AT", 2, 1]]],
        "H_HelmetB_light_desert", 
        "G_Bandanna_tan", 
        [], 
        ["ItemMap", "", "ItemRadio", "ItemCompass", "ItemWatch", "NVGoggles"]
      ]
    ]
    ```

### 5. `setCombatMode`
*   **Description**: Sets the combat mode (rules of engagement) for a group.
*   **Query Argument**: `[string, string]` (`[group_netId, mode]`, e.g., "RED", "YELLOW", "GREEN")
*   **Returns (`queryResult`)**: `boolean` (`true` if the group was found and modified, `false` otherwise)
*   **Example Response**:
    ```json
    ["setCombatMode", ["0:289", "RED"], true]
    ```

### 6. `setCombatBehaviour`
*   **Description**: Sets the combat behaviour (e.g., AWARE, COMBAT, STEALTH) for a group or a specific unit.
*   **Query Argument**: `[string, string]` (`[netId, behaviour]`, where netId can be a unit or group)
*   **Returns (`queryResult`)**: `boolean` (`true` if the group/unit was found and modified, `false` otherwise)
*   **Example Response**:
    ```json
    ["setCombatBehaviour", ["0:289", "COMBAT"], true]
    ```

### 7. `setGroupId`
*   **Description**: Renames a group's identifier/callsign.
*   **Query Argument**: `[string, string]` (`[group_netId, newName]`)
*   **Returns (`queryResult`)**: `boolean` (`true` if the group was found and modified, `false` otherwise)
*   **Example Response**:
    ```json
    ["setGroupId", ["0:289", "Bravo 2-1"], true]
    ```

### 8. `setFormation`
*   **Description**: Changes the physical formation of the group (e.g., LINE, WEDGE, COLUMN).
*   **Query Argument**: `[string, string]` (`[group_netId, formation]`)
*   **Returns (`queryResult`)**: `boolean` (`true` if the group was found and modified, `false` otherwise)
*   **Example Response**:
    ```json
    ["setFormation", ["0:289", "WEDGE"], true]
    ```

### 9. `commandMove`
*   **Description**: Orders one or more units to move to a specific position.
*   **Query Argument**: `[list[string], list[number]]` (`[array_of_unit_netIds, [x, y] or [x, y, z]]`)
*   **Returns (`queryResult`)**: `boolean` (`true` if at least one target unit was found and commanded, `false` otherwise)
*   **Example Response**:
    ```json
    [
      "commandMove", 
      [["0:1779946", "0:1873948"], [14000.5, 12050.2]], 
      true
    ]
    ```

### 10. `getGroupAssignedVehicle`
*   **Description**: Retrieves a list of vehicles assigned to a specified group.
*   **Query Argument**: `string` (Group `netId`)
*   **Returns (`queryResult`)**: `list[list[string, string]]` (A list of `[netId, vehicleClass/typeOf]` pairs). If the group is not found, returns `["error", "Group not found or is null"]`.
*   **Example Response**:
    ```json
    [
      "getGroupAssignedVehicle", 
      "0:289", 
      [
        ["0:3412", "B_MRAP_01_F"],
        ["0:3413", "B_Truck_01_transport_F"]
      ]
    ]
    ```

### 11. `addWaypoint`
*   **Description**: Adds (or inserts when index is given) a new waypoint to a group.
*   **Query Argument**: `[string, list[number], number, number, string]` (`[group_netId, center_position, radius, index, name]`)
*   **Returns (`queryResult`)**: `[string, number]` (The created waypoint as `[group_netId, index]`). If the group is not found, returns `["error", "Group not found or is null"]`.
*   **Example Response**:
    ```json
    [
      "addWaypoint", 
      ["0:289", [14000.5, 12050.2, 0], 0, -1, "WP1"],
      ["0:289", 1]
    ]
    ```

### 12. `waypoints`
*   **Description**: Retrieves a list of all waypoints for a specified group.
*   **Query Argument**: `string` (Group `netId`)
*   **Returns (`queryResult`)**: `list[list[string, number]]` (A list of waypoints as `[group_netId, index]` pairs). If the group is not found, returns `["error", "Group not found or is null"]`.
*   **Example Response**:
    ```json
    [
      "waypoints", 
      "0:289", 
      [
        ["0:289", 0],
        ["0:289", 1]
      ]
    ]
    ```

### Unknown Command Fallback
If an unsupported `queryType` is passed to SQF via Python, it returns a literal error string message.
*   **Description**: Catch-all for unresolved or mistyped queries.
*   **Returns (`queryResult`)**: `string` ("ERROR: Unknown Command")
*   **Example Response**:
    ```json
    ["made_up_cmd", "some_arg", "ERROR: Unknown Command"]
    ```

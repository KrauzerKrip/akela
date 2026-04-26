hint "Init";

//waitUntil { !isNil "py3_fnc_callExtension" };
[] spawn {
scriptName "Pythia_Polling_Loop";
    while {true} do {
        // 1. Poll Python.
        // Returns a HashMap if data exists, or an empty Array [] if the queue was empty.
        private _requestData = ["AkelaMod.pollRequest", []] call py3_fnc_callExtension;
        if (count _requestData > 0) then {
};
        // 2. Check if we received an Array containing [id, data]
        if (_requestData isEqualType [] && {count _requestData == 2}) then {
            // Extract the data
            private _reqId = _requestData select 0;
            private _queries = _requestData select 1;

            private _responsePayload = [];

            // 3. Process each query
            {
                private _queryType = _x select 0;
                private _queryArg  = _x select 1;
                private _queryResult = [];
                switch (_queryType) do {
                    case "log": {
                        // _queryArg is the string message from Python
                        systemChat (format ["[PYTHON] %1", _queryArg]);
                        diag_log (format ["[PYTHON] %1", _queryArg]); // Also log to RPT file
                        _queryResult = true; // Just a dummy return
                    };

                    // --- GROUPS ---
                    case "groups": {
                        // _queryArg is a side string like "BLUFOR"
                        private _side = switch (toUpper _queryArg) do {
                            case "BLUFOR"; case "WEST": {west};
                            case "OPFOR"; case "EAST": {east};
                            case "INDEPENDENT"; case "GUER": {independent};
                            case "CIVILIAN"; case "CIV": {civilian};
                            default {sideUnknown};
                        };

                        // Build a HashMap of {"netId": "GroupId"}
                        {
                            if (side _x == _side) then {
                                _queryResult pushBack [netId _x, groupId _x];
                            };
                        } forEach allGroups;
                    };

                    // --- UNITS ---
                    case "units": {
                        // _queryArg is a group netId string like "0:289"
                        private _grp = groupFromNetId _queryArg;

                        if (!isNull _grp) then {
                            // Build a HashMap of {"netId": "UnitName"}
                            {
                                _queryResult pushBack [netId _x, name _x];
                            } forEach (units _grp);
                        } else {
                            _queryResult pushBack ["error", "Group not found or is null"];
                        };
                    };

                    // --- LOADOUT ---
                    case "getUnitLoadout": {
                        // _queryArg is a unit netId string like "0:1779946"
                        private _unit = objectFromNetId _queryArg;

                        if (!isNull _unit) then {
                            // getUnitLoadout returns an array, so we overwrite the HashMap
                            _queryResult = getUnitLoadout _unit;
                        } else {
                            _queryResult = []; // Return empty if unit doesn't exist/died
                        };
                    };

                    case "setCombatMode": {
                        private _grp = groupFromNetId (_queryArg select 0);
                        private _mode = _queryArg select 1;
                        if (!isNull _grp) then {
                            _grp setCombatMode _mode;
                            _queryResult = true;
                        } else {
                            _queryResult = false;
                        };
                    };

                    case "setCombatBehaviour": {
                        private _netId = _queryArg select 0;
                        private _behaviour = _queryArg select 1;
                        private _grp = groupFromNetId _netId;
                        if (!isNull _grp) then {
                            _grp setCombatBehaviour _behaviour;
                            _queryResult = true;
                        } else {
                            private _unit = objectFromNetId _netId;
                            if (!isNull _unit) then {
                                _unit setCombatBehaviour _behaviour;
                                _queryResult = true;
                            } else {
                                _queryResult = false;
                            };
                        };
                    };

                    case "setGroupId": {
                        private _grp = groupFromNetId (_queryArg select 0);
                        private _name = _queryArg select 1;
                        if (!isNull _grp) then {
                            _grp setGroupId [_name];
                            _queryResult = true;
                        } else {
                            _queryResult = false;
                        };
                    };

                    case "setFormation": {
                        private _grp = groupFromNetId (_queryArg select 0);
                        private _formation = _queryArg select 1;
                        if (!isNull _grp) then {
                            _grp setFormation _formation;
                            _queryResult = true;
                        } else {
                            _queryResult = false;
                        };
                    };

                    case "commandMove": {
                        private _netIds = _queryArg select 0;
                        private _pos = _queryArg select 1;
                        if (count _pos == 2) then {
                            _pos = [_pos select 0, _pos select 1, getTerrainHeightASL _pos];
                        };
                        private _units = [];
                        {
                            private _u = objectFromNetId _x;
                            if (!isNull _u) then { _units pushBack _u; };
                        } forEach _netIds;

                        if (count _units > 0) then {
                            _units commandMove _pos;
                            _queryResult = true;
                        } else {
                            _queryResult = false;
                        };
                    };

                    case "getGroupAssignedVehicle": {
                        private _grp = groupFromNetId _queryArg;
                        if (!isNull _grp) then {
                            private _vehArr = [];
                            {
                                _vehArr pushBack [netId _x, typeOf _x];
                            } forEach (assignedVehicles _grp);
                            _queryResult = _vehArr;
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };

                    case "addWaypoint": {
                        private _grp = groupFromNetId (_queryArg select 0);
                        if (!isNull _grp) then {
                            private _center = _queryArg select 1;
                            private _radius = _queryArg select 2;
                            private _index = _queryArg select 3;
                            private _name = _queryArg select 4;
                            private _wp = _grp addWaypoint [_center, _radius, _index, _name];
                            _queryResult = [netId (_wp select 0), _wp select 1];
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };

                    case "waypoints": {
                        private _grp = groupFromNetId _queryArg;
                        if (!isNull _grp) then {
                            private _wps = waypoints _grp;
                            private _ret = [];
                            {
                                _ret pushBack [netId (_x select 0), _x select 1];
                            } forEach _wps;
                            _queryResult = _ret;
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };

                    case "getWaypointPosition": {
                        private _grp = groupFromNetId (_queryArg select 0);
                        if (!isNull _grp) then {
                            private _index = _queryArg select 1;
                            private _wpPos = waypointPosition [_grp, _index];
                            _queryResult = _wpPos;
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };

                    case "getGroupLeaderPosition": {
                        private _grp = groupFromNetId _queryArg;
                        if (!isNull _grp) then {
                            private _ldPos = getPos (leader _grp);
                            _queryResult = _ldPos;
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };

                    // --- COMMAND: LOAD VEHICLE ---
                    case "commandLoad": {
                        // _queryArg format: [troopGroupNetId, vehicleNetId]
                        private _grp = groupFromNetId (_queryArg select 0);
                        private _veh = objectFromNetId (_queryArg select 1);

                        if (!isNull _grp && !isNull _veh) then {
                            // 1. Tell the group this vehicle belongs to their transport pool
                            _grp addVehicle _veh; 
                            
                            // 2. Order each unit to get in
                            {
                                if (alive _x && vehicle _x == _x) then { // If alive and on foot
                                    [_x] allowGetIn true;
                                    _x assignAsCargo _veh;
                                    [_x] orderGetIn true;
                                };
                            } forEach units _grp;
                            
                            _queryResult = true;
                        } else {
                            _queryResult = ["error", "Group or Vehicle not found"];
                        };
                    };

                    // --- COMMAND: UNLOAD VEHICLE ---
                    case "commandUnload": {
                        // _queryArg format: troopGroupNetId
                        private _grp = groupFromNetId _queryArg;

                        if (!isNull _grp) then {
                            {
                                if (alive _x && vehicle _x != _x) then { // If alive and inside a vehicle
                                    unassignVehicle _x;
                                    _x action ["getOut", vehicle _x];
                                    [_x] orderGetIn false;
                                    [_x] allowGetIn false;
                                };
                            } forEach units _grp;
                            
                            // Optional: Officially remove the vehicle from the group's memory
                            _grp leaveVehicle (assignedVehicle (leader _grp));
                            
                            _queryResult = true;
                        } else {
                            _queryResult = ["error", "Group not found"];
                        };
                    };

                    case "addEventHandlers": {
                        private _grp = groupFromNetId _queryArg;
                        if (!isNull _grp) then {
                            _grp addEventHandler ["CombatModeChanged", {
                                params ["_group", "_newMode"];
                                ["AkelaMod.on_event", ["CombatModeChanged", [netId _group, _newMode]]] call py3_fnc_callExtension;
                            }];
                            _grp addEventHandler ["UnitKilled", {
                                params ["_group", "_unit", "_killer", "_instigator", "_useEffects"];
                                ["AkelaMod.on_event", ["UnitKilled", [netId _group, netId _unit, netId _killer, netId _instigator, _useEffects]]] call py3_fnc_callExtension;
                            }];
                            _grp addEventHandler ["WaypointComplete", {
                                params ["_group", "_waypointIndex"];
                                ["AkelaMod.on_event", ["WaypointComplete", [netId _group, _waypointIndex]]] call py3_fnc_callExtension;
                            }];
                            _grp addEventHandler ["EnemyDetected", {
                                params ["_group", "_newTarget"];
                            
                                private _type = "Unknown";
                            
                                // Sort the target based on the hierarchy in your table
                                call {
                                    if (_newTarget isKindOf "Man") exitWith { _type = "Soldier" };
                                    if (_newTarget isKindOf "Tank") exitWith { _type = "Tank" };
                                    if (_newTarget isKindOf "Wheeled_APC_F") exitWith { _type = "WheeledAPC" };
                                    if (_newTarget isKindOf "Tracked_APC") exitWith { _type = "TrackedAPC" };
                                    if (_newTarget isKindOf "Helicopter") exitWith { _type = "Helicopter" };
                                    if (_newTarget isKindOf "Plane") exitWith { _type = "Plane" };
                                    if (_newTarget isKindOf "Ship") exitWith { _type = "Ship" };
                                    if (_newTarget isKindOf "StaticWeapon") exitWith { _type = "StaticWeapon" };
                                    if (_newTarget isKindOf "Car") exitWith { _type = "Car" };
                                };
                            
                                // Pass the type as the 4th element in your data array
                                ["AkelaMod.on_event", [
                                    "EnemyDetected", 
                                    [netId _group, netId _newTarget, getPos _newTarget, _type]
                                ]] call py3_fnc_callExtension;
                            }];
                            _queryResult = true;
                        } else {
                            _queryResult = ["error", "Group not found or is null"];
                        };
                    };
 
                    default {
                        _queryResult = "ERROR: Unknown Command";
                    };
                };

                // Append the result as [queryType, queryArg, resultData]
                _responsePayload pushBack [_queryType, _queryArg, _queryResult];

            } forEach _queries;

            // 4. Send the payload back to Python's respond() function
            ["AkelaMod.respond", [_reqId, _responsePayload]] call py3_fnc_callExtension;
        } else {
            
        };

        sleep 0.1;
    };
};

systemChat "Polling loop started";
diag_log "PYTHIA: Polling loop started in Eden.";

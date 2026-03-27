hint "Init";

//waitUntil { !isNil "py3_fnc_callExtension" };
[] spawn {
scriptName "Pythia_Polling_Loop";
    while {true} do {
        // 1. Poll Python.
        // Returns a HashMap if data exists, or an empty Array [] if the queue was empty.
        private _requestData = ["AkelaMod.pollRequest", []] call py3_fnc_callExtension;
        if (count _requestData > 0) then {
    hint str _requestData; // Prints to the in-game chat
};
        // 2. Check if we received an Array containing [id, data]
        if (_requestData isEqualType [] && {count _requestData == 2}) then {
            // Extract the data
            hint "IF";
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

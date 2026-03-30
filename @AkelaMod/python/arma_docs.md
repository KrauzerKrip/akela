# Events
## Event handling
### addEventHandler
Adds an Event Handler to the given object.

    As many Event Handlers of any type can be added - existing Event Handlers do not get overwritten
    Use removeEventHandler to remove an Event Handler

Read Event Handlers for more information and a list of all available Event Handlers.
    target addEventHandler [type, code]
Parameters:
    target: Object or
    Arma 3 logo black.png
    2.10
    Group
    type: String - see Event Handlers for the full list of available options
    code: Code or String - code that should be executed when the Event Handler fires; executed in missionNamespace by default. Several Magic Variables are available:

        Event Handler parameters are accessible via _this
        The Event Handler type is available as _thisEvent
        The Event Handler index is available as _thisEventHandler

Return Value:
    Number - the index of the added Event Handler. Indices start at 0 for each unit and increment with each added Event Handler.

```
this addEventHandler ["Killed", {
	params ["_unit", "_killer"];
	systemChat format ["%1 has been killed by %2.", _unit, _killer];
}];
```


### removeEventHandler
Removes a given Event Handler that was added with addEventHandler.


Syntax:
    target removeEventHandler [type, index]
Parameters:
    target: Object or
    Arma 3 logo black.png
    2.10
    Group
    type: String - see Event Handlers for the full list of available options
    index: Number - the value originally returned by addEventHandler
Return Value:
    Nothing 

```
player removeEventHandler ["Killed", 0];
```

```
player addEventHandler ["FiredNear", {
	systemChat "This Event Handler is now removing itself!";
	player removeEventHandler [_thisEvent, _thisEventHandler];
}];
```

## Group events
### CombatModeChanged[](https://community.bistudio.com/wiki/Arma_3:_Event_Handlers#CombatModeChanged)

Triggers when the group's **[behaviour](https://community.bistudio.com/wiki/AI_Behaviour "AI Behaviour")** changes (see [behaviour](https://community.bistudio.com/wiki/behaviour "behaviour"), [setBehaviour](https://community.bistudio.com/wiki/setBehaviour "setBehaviour"))

_group [addEventHandler](https://community.bistudio.com/wiki/addEventHandler) ["CombatModeChanged", { [params](https://community.bistudio.com/wiki/params) ["_group", "_newMode"]; }];

- group: [Group](https://community.bistudio.com/wiki/Group "Group")
- newMode: [String](https://community.bistudio.com/wiki/String "String") - see [AI Behaviour](https://community.bistudio.com/wiki/AI_Behaviour "AI Behaviour") (**not** [Combat Modes](https://community.bistudio.com/wiki/Combat_Modes "Combat Modes")!)


### UnitKilled[](https://community.bistudio.com/wiki/Arma_3:_Event_Handlers#UnitKilled)

[LALocal](https://community.bistudio.com/wiki/Multiplayer_Scripting#Locality "Multiplayer Scripting")  
Triggered when a unit in the group is killed.

_group [addEventHandler](https://community.bistudio.com/wiki/addEventHandler) ["UnitKilled", { [params](https://community.bistudio.com/wiki/params) ["_group", "_unit", "_killer", "_instigator", "_useEffects"]; }];

- group: [Group](https://community.bistudio.com/wiki/Group "Group") - the group the event handler is assigned to
- unit: [Object](https://community.bistudio.com/wiki/Object "Object") - the unit that was killed
- killer: [Object](https://community.bistudio.com/wiki/Object "Object") - the object that killed the unit. Contains the unit itself in case of collisions.
- instigator: [Object](https://community.bistudio.com/wiki/Object "Object") - the person who pulled the trigger
- useEffects: [Boolean](https://community.bistudio.com/wiki/Boolean "Boolean") - same as _useEffects_ in [setDamage](https://community.bistudio.com/wiki/setDamage "setDamage") alt syntax
### WaypointComplete[](https://community.bistudio.com/wiki/Arma_3:_Event_Handlers#WaypointComplete)

_group [addEventHandler](https://community.bistudio.com/wiki/addEventHandler) ["WaypointComplete", { [params](https://community.bistudio.com/wiki/params) ["_group", "_waypointIndex"]; }];

- group: [Group](https://community.bistudio.com/wiki/Group "Group")
- waypointIndex: [Number](https://community.bistudio.com/wiki/Number "Number")

### EnemyDetected[](https://community.bistudio.com/wiki/Arma_3:_Event_Handlers#EnemyDetected)

_group [addEventHandler](https://community.bistudio.com/wiki/addEventHandler) ["EnemyDetected", { [params](https://community.bistudio.com/wiki/params) ["_group", "_newTarget"]; }];

- group: [Group](https://community.bistudio.com/wiki/Group "Group")
- newTarget: [Object](https://community.bistudio.com/wiki/Object "Object")
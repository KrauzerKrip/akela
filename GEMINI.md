# Akela - Arma 3 Agentic Commander

## Project Description
Akela is an LLM-powered agentic system that integrates directly with the Arma 3 game engine to act as an autonomous military commander. It relies on real-time situational awareness to run a fully automated `Intel -> Plan -> Execution` loop for simulated artificial armies. It uses Google ADK for agent implementation.

### Core Architecture
1. **Arma Connection (`backend/src/arma_connection.ts`, `backend/src/server.ts`)**
   - Uses an Elysia HTTP server to bridge communication between the JS runtime and Arma 3.
   - The Arma 3 extension seamlessly bridges JS runtime execution through `sqf` scripts and Pythia logic. It continuously polls `/poll` for game commands and sends real-time game events/responses to `/respond`, `/log`, and `/new-event`.
   
2. **Domain Models (`backend/src/army.ts`, `backend/src/combat.ts`)**
   - The game state is abstracted into strongly typed domain entities such as `Army`, `Group`, `Unit`, `Task` (Push, Assault, Retreat, Wait), and `Waypoint`.
   - `ArmyCombatMonitor` tracks real-time engagement mechanics, casualties, and contact clustering.
   - Converts raw game states into comprehensible Situation Reports (SITREPs) via `yaml` text blocks for LLMs.

3. **Agentic Pipeline (`backend/src/agent.ts`, `backend/src/index.ts`)**
   Powered by `@google/adk` and `@google/genai` to utilize multi-modal conversational Gemini models.
   - **IntelAgent**: Analyzes overhead intelligence images (satellite mappings, framework primitives) and textual observation data.
   - **PlanAgent**: Combines SITREPs and Intelligence reports to devise tactical macro-plans. It uses a `PlanSandbox` to simulate the JS code that it writes to interact with `Group` instances. It uses image generation tool callbacks to visually scrutinize its plan on a drawn map.
   - **ExecutionAgent**: Takes the constructed plan and reacts to live runtime feedback via streamed SITREP updates, pivoting dynamically.

4. **Geography & Map Extraction (`backend/src/geography.ts`)**
   - Dynamically generates map bounding boxes derived from local area coordinates.
   - Spawns python sub-processors (`python/area.py`) to scrape exact topological image layers directly from Arma's datasets representing frames, grids, and satellite terrain for multimodal LLM vision.

## What a model should know to work with this code
1. **Command Line runner**: Use `bun` to run the backend. **DO NOT USE `bun run tsc`**. Run files natively with `bun run <file>`. (e.g. `bun run src/index.ts --params params.json`) or bun build
2. **Arma 3 SQF scripting**: If instructed to modify `.sqf` script files, consult the partial Arma 3 documentation explicitly located at `/@AkelaMod/python/arma_docs.md`.
3. **Session Output Storage**: All runtime events are logged and mapped to isolated directories generated in `.data/sessions/<id>`. This includes a `manifest.json` detailing the `Plan` events, user inputs, and intel summaries.
4. **Agent Tools & Sandbox**: LLM tools are strictly typed leveraging `zod` for argument definitions and run within custom asynchronous contexts. Tactical group interactions are deeply rooted within Domain Events in `Group` objects, resolving JS promises hooked accurately through listeners (`ArmyCombatMonitor`).
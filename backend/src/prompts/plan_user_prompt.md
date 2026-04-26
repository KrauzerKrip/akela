# INTELLIGENCE REPORT
{{INTEL_BLOCK}}

# SITREP (your side)
{{SITREP_BLOCK}}

Review the intelligence and the current group statuses. Use the `visualize_plan` tool to draft your JS actions, test them, and verify they look correct on the map. 

**IMPORTANT REMINDERS**:
1. Do not skip testing. If your visualization attempt fails, you MUST run `visualize_plan` again after fixing the code. Never commit unverified code.
2. Ensure your plan relies heavily on the `Report` task inside event listeners. Check for high `.getCasualtyRatio()` during `KIA` events, and log unexpected vehicle/infantry counts during `ENEMY_CONTACT` events to ensure Command is aware of anomalies.
3. Make sure the plan works (both visually and syntax) before passing it to the execution agent.

When ready and verified, use `commit_to_plan`, and output your comprehensive textual plan.
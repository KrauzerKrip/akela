---

Merged UAV findings (with evidence photo labels). Use these together with the **gridded satellite map image** supplied in the same user message (after this text) to place marks.

When a merged finding includes `coordinateReadouts`, treat those as **first-class anchoring evidence**: reconcile them with map extent and tick interpolation rules from the main Intel system prompt (including six-digit grid conventions). When `coordinateReadouts` indicates UAV-only positions, use them as approximate geographic context combined with visual landmarks from `description` / `roughLocationHint`.

You MUST attempt to represent major hostile positions, overwatches, armor/MRAP, checkpoints, coastal threats, and medical/IDAP/civilian concentrations when supported by evidence.

If a merged finding cannot be placed confidently on the map, omit it from `marks` but mention it in the narrative `report`.

Include a short **Evidence appendix** paragraph at the end of `report` listing each emitted mark's id/label and its `sourcePhotoLabels` from the merged list when applicable.

Map extent reminder:
{{MAP_EXTENT_LINE}}

Merged findings JSON:
{{MERGED_FINDINGS_JSON}}

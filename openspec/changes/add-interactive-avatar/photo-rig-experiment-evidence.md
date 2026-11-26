# Offline photo rig experiment — 2026-11-26

This is evidence from a local experimental asset, not a shipping runtime or verified photoreal reconstruction. The original photograph-based silhouette mesh was skinned with a manually fitted 19-joint hierarchy, distance-based anatomical weighting and mesh-neighborhood smoothing, normalized four-joint weights and inverse bind matrices. Three named rotation animation clips (Idle, Explain, Listen) are stored inside the GLB. Offline CPU linear blend skinning produced reference stills; a separate reader decoded the exported GLB animation and rendered 32 frames of Explain. The existing JACO renderer and its runtime assets are unchanged by this evidence commit.

Measured local experiment:
- 65,274 vertices; 130,544 triangles, original prototype geometry retained.
- 19 joints, 3 animation clips, 0 facial morphs, baked vertex colors (not PBR UV materials).
- Maximum joint-weight sum error 1.1920928955078125e-7.
- Max rest-pose vertex displacement 7.303696446516725e-8 m.
- Median selected hand displacement 0.22966422869456582 m at peak Explain gesture.
- Max measured vertex displacement near floor in that gesture 1.3877787807814457e-17 m; not a walking or IK test.
- Output GLB 4,991,864 bytes; SHA-256 68526717e0af1ded70c53ee2ba1ea922a391baeee9ebb3413f5510f6a49cb65d.

The source geometry still exhibits flattened face and inaccurate side depth, fused hair, no finger articulation and no mouth/eye deformation. The A-pose and stylized procedural movement are unsuitable for final delivery. No new texture or reconstruction model was executed: the local environment has no CUDA and cannot resolve the upstream download host; a previous GitHub source artifact request returned 404. No paid compute was started. No GPU timing, browser playback or real device acceptance was performed in this increment. The binary and local Python experiment scripts are delivered separately to the operator, not committed to this PR.

Next evidence gate: obtain license-cleared multi-view reconstruction or fit a genuine anatomical base mesh, replace rather than ship the silhouette extrusion, preserve integrated face morphs, retopologize, separate hair and clothing, validate timed visemes and verify performance with the real JACO runtime. Retain the approved dark neutral backdrop. Do not merge this experiment as a production avatar or report 8/10 visual acceptance without operator review.

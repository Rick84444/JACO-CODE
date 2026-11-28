# Aura production garment material contract
2026-11-26. Operator requires a permanent lifelike character, not a demo. Approved generated full-body portrait: opaque fitted silver-blue utility suit, high collar, front zipper, narrow cyan lines, utility belt, thigh cargo pockets, knee reinforcement, lace-up boots, long platinum hair. Preserve identity, avoid glossy chrome textile and exaggerated emissive bloom. Existing V4 casualsuit/ponytail are not final assets.

## Local material authoring experiment
Six original procedural tileable 512x512 materials; 19 PNG maps: base color (sRGB), tangent normal (+Y glTF, linear), packed metallic-roughness (G roughness/B metallic/R 1, linear), plus emissive map for light housing. Nominal parameters (authored starting points, not measured BRDFs):
- technical textile #8999AA, metal 0, roughness .64
- reinforcement #536374, metal 0, roughness .78
- brushed titanium #B5C0C9, metal 1, roughness .34
- boot upper #82909D, metal 0, roughness .69
- rubber sole #394652, metal 0, roughness .86
- light housing #467989, metal 0, roughness .42, emission #55C9F0.
Manual patches from approved reference are lit image RGB, not intrinsic material colors; textile #7C8FA9, knee #607289. Metallic material identification is artistic inference, not physical measurement. The local generator was syntax-checked, all 19 maps decoded, metallic channels and normal lengths validated, then generated again with identical hashes. Files, manifest and generator delivered separately in a 659631-byte archive. Not integrated with runtime, not a PBR render or measured photorealism. No existing asset or renderer changes.

## Garment construction
Separate continuous skinned garment with tailored front/back panels, real collar and zipper path, pockets and straps, reinforced knee/elbow panels, separate soles and laces. Use opaque clothing geometry; no body-paint approximation. Maintain compatible skeleton and pose corrections. Use local UV scale with consistent textile weave physical size; actual seam curves, normal/baked stitches where small, geometric zipper teeth only near camera, hardware only metallic. Place emissive stripes on the intended seams and restrict bloom; do not make surrounding cloth emissive. Match garment fold behavior to joint positions and include corrective shapes at elbows, knees, waist and shoulders. Verify clothed silhouette and no skin intersections in held-out poses. Keep hardware and light details readable at actual full-body display scale.

## Acceptance
Compare neutral front/side/back and held-out gesture poses with reference and controlled neutral lighting. Texture sampling must not hide missing anatomy. Test fabric under several lights, distinguish soft sheen from metallic reflections, prevent moire at actual display size, test emissive off/on, compare full-body and close-up. GPU cost and UV/material integration remain unmeasured. Use existing runtime and preserve one rig. No merge or claim of final production quality until visual acceptance and real device tests.

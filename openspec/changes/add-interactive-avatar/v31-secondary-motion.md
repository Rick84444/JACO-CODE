# V31 secondary motion

The original V31 contains four ponytail joints and three authored signed morphs on the separate photo-hair mesh: HairFrontSway, HairBackSway, HairSideSway. Their maximum authored displacement is about 26 mm. Use a bounded spring chain driven by measured frame-to-frame head orientation and root travel. Preserve rest at zero and reset on reduced motion or discontinuities. No external mocap clip or new mesh is introduced.

The fitted technical garment has skin weights but no cloth morphs. The first implementation adds only restrained, reversible roughness response tied to gesture and gait; it is not cloth simulation. Floor and local foot-contact shadow are staged only during wide framing; no reflection or true shadow solver is claimed. Use a tiny local shader and no extra network dependencies.

Acceptance: validate spring stability, motion cancellation, actual hair morph deformation, floor/foot contact and appearance on V31, including hair-body intersections, clothing penetration and GPU cost. Motion capture retargeting and genuine cloth simulation remain separate tasks. Unit tests are not visual proof.

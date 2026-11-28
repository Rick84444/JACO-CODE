# HeadAudio provenance

MIT, Copyright 2025 Mika Suominen; original LICENSE accompanies all files.
Exact upstream revision: https://github.com/met4citizen/HeadAudio/commit/9f7654914559cf3beaf731117d2efa91958ef640
Original modules from modules/, binary from dist/model-en-mixed.bin. All original blob hashes verified on transfer. JACO subsequently removes trailing whitespace and the unused no-op Training.update method to comply with repository debt checks; the classifier and model record decoding are otherwise unchanged. The English Gaussian model was trained by upstream using HeadTTS and Harvard Sentences; Swedish accuracy remains unverified. No external runtime dependencies or remote inference. This is classification, not forced alignment. The model's separate training-data provenance requires review before commercial release.

---
'@retro-engine/engine': patch
---

fix(engine): pad mesh buffer uploads to a 4-byte multiple

WebGPU's `writeBuffer` rejects a byte length that is not a multiple of 4. A `uint16` index buffer with an odd index count (e.g. a single triangle — 3 indices, 6 bytes) is `2 mod 4` and failed to upload. The `MeshAllocator` already sizes each allocation to a 4-byte multiple, but wrote the raw unpadded data; it now zero-pads the upload to the same alignment. Built-in primitives have even index counts so never hit this, but imported meshes (glTF) routinely have odd counts.

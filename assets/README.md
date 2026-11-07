# Original artwork

The runtime uses `../public/models/Board.glb`, `Checker_Red.glb`, `Checker_Ivory.glb` and `Die.glb`, copied byte-for-byte from the original asset set. Each GLB contains its own geometry, materials and texture images.

`source/Plakoto_Source.blend` is the editable, packed Blender file. `source/build_assets.py` recreates the asset set with Blender and writes to `source/generated/`; it does not overwrite the game’s approved runtime models. Run from Blender’s scripting workspace, or with `blender --background --python assets/source/build_assets.py`.

`exports/` retains the original standalone FBX models. `textures/` retains their texture sources. `reference/asset-preview.png` is the original combined preview. Redundant GLB libraries, Blender autosave backups and superseded game drafts were omitted.

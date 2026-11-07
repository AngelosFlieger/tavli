# Plakoto / Tavli asset pack

Four reusable assets built from the supplied concept: Board, Checker_Ivory, Checker_Red and Die. Each has its own FBX and self-contained GLB. Duplicate the single pieces in your game as needed. Plakoto_Asset_Library.glb contains all four arranged for inspection. Plakoto_Source.blend includes packed textures and a preview camera/light setup.

## Import into Unity (FBX route)

1. Copy the four FBX files and Textures folder into an Assets/Plakoto folder in your Unity project. Keep the .blend source outside Assets to avoid importing a duplicate preview scene.
2. Select each FBX in the Project window. Keep unit conversion enabled and use Scale Factor 1. The board should measure approximately 0.64 × 0.48 metres. Check dimensions before building gameplay around it.
3. In the Materials tab, extract embedded textures/materials if needed. Assign the supplied PNG with the matching material name to its Base Map/Albedo. Use white material tint so the texture colors are preserved. Gold is a solid gold color, metallic 0.65; other materials are nonmetallic with roughness about 0.68 (smoothness about 0.32).
4. Use your project's material shader: Standard for Built-in, URP/Lit for URP, or HDRP/Lit for HDRP. If materials appear pink, change their shader and reassign the Base Map.
5. Select the PNG textures: use sRGB color, Repeat wrap and Point filtering for crisp pixel dither. Keep mipmaps for distant views; disable only if your fixed camera makes the pattern too soft. Avoid texture compression if it damages small dither marks.
6. Drag each asset into your scene, then create your own prefabs. Add colliders suited to gameplay: simple box colliders for the board base/rails; a convex checker collider or a simplified collider; a BoxCollider and Rigidbody for the die. Automatic convex collision on the entire board would fill the recesses, so use separate simple colliders.

Unity's model import and material workflow is documented here:
https://docs.unity.com/en-us/engine/6000.6/manual/assets-and-media/asset-types/models/importing/importing-model-files

## GLB alternative

Use a compatible glTF importer, such as Unity glTFast or Khronos UnityGLTF. GLB embeds all image textures and PBR materials. Do not import FBX and GLB versions together unless you intentionally want duplicates.
UnityGLTF's installation/import instructions: https://github.com/KhronosGroup/UnityGLTF/blob/main/README.md

## Geometry and placement

- Board: one named mesh with 24 triangular point surfaces, 12 red and 12 ivory. Six points per quadrant; colors alternate along each edge, including across the central bar. Raised central rails, gold hinge details, four recessed side trays and two star badges are included.
- Checker_Ivory and Checker_Red: one named mesh each, with beveled coin body, inset face ring and star emblem. Diameter 0.0314 m, height about 0.0115 m. Origin at bottom center. Stack with a vertical pitch of at least 0.0115 m.
- Die: one named mesh containing the beveled body and modeled pip inserts on all six faces. Body 0.022 m per side; opposite face values total seven. Origin at bottom center. Put it under a parent centered 0.011 m above its origin if you need rotation about the physical center.
- Board origin is centered in plan at the bottom of the base. The playing surface is approximately 0.0275 m above the origin. Place a checker's bottom slightly above this height to avoid surface overlap.
- Blender source uses Z-up; GLB uses Y-up. FBX contains axis/unit conversion metadata. Confirm the result is horizontal in Unity before saving prefabs.
- Individual exports have zero position and are suitable for instancing. The combined library offsets the three smaller assets beside the board for viewing.

## Scope and verification

These are actual 3D meshes, not image billboards. Felt waves, stars and points are thin decorative surfaces; use solid body geometry for physics. The open board is a single static mesh: hinges are decorative and the halves are not rigged for folding. No gameplay code, dice outcome reader, collision setup, animation or Unity scene is included.

The appearance is inspired by the supplied concept, with original procedural dither textures; it is not an exact pixel-for-pixel reconstruction. Lighting and color management affect the final colors. The preview image is a Blender render of these meshes.

Verified: Blender generation/export, rendered visual inspection, GLB container integrity, four expected library mesh names, embedded GLB image data. Unity itself was not run; pipeline-specific material adjustments may be needed. Triangle counts are recorded in mesh_report.json.

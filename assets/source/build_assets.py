import bpy, math, random, os, json
from mathutils import Vector
from pathlib import Path
OUT=str(Path(__file__).resolve().parent / 'generated'); os.makedirs(OUT,exist_ok=True)
os.makedirs(os.path.join(OUT, 'Textures'), exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(9)
def mat(name, rgb, textured=True, metal=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*rgb,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*rgb,1); p.inputs['Roughness'].default_value=.68; p.inputs['Metallic'].default_value=metal
 if textured:
  n=128; im=bpy.data.images.new(name+'_Dither',width=n,height=n); px=[]
  for y in range(n):
   for x in range(n):
    wave=math.sin(x*.075+y*.04+math.sin(y*.07)*2)
    bayer=((x%4)*2+(y%4)*3)%8
    f=(.78 if bayer<2 else 1.04) * (1.10 if wave>.3 else .94)
    px.extend([min(1,c*f) for c in rgb]+[1])
  im.pixels=px; im.filepath_raw=OUT+'/Textures/'+name+'.png'; im.file_format='PNG'; im.save()
  tex=m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=im; tex.interpolation='Closest'; m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 return m
navy=mat('Felt_Navy',(.055,.105,.19)); plum=mat('Frame_Plum',(.24,.065,.15)); red=mat('Crimson',(.78,.035,.045)); ivory=mat('Ivory',(.95,.79,.51)); gold=mat('Gold',(.78,.44,.12),False,.65); dark=mat('Recess_Shadow',(.025,.025,.055)); blue=mat('Felt_Swirl',(.085,.18,.30)); rim=mat('Rim_Crimson',(.42,.045,.085))
parts=[]
def finish(o,name,m):
 o.name=name; o.data.materials.append(m); parts.append(o); return o
def cube(name,loc,scale,m,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Soft_edges','BEVEL'); mod.width=bevel; mod.segments=2; bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,m)
def cyl(name,loc,r,depth,m,vertices=64):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc); o=bpy.context.object
 b=o.modifiers.new('Coin_bevel','BEVEL'); b.width=.0015; b.segments=2; bpy.ops.object.modifier_apply(modifier=b.name)
 return finish(o,name,m)
def poly(name,verts,m):
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],[list(range(len(verts)))]); mesh.update(); o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
 uv=mesh.uv_layers.new()
 for l in mesh.loops: uv.data[l.index].uv=(verts[l.vertex_index][0]*7,verts[l.vertex_index][1]*7)
 return finish(o,name,m)
def star(name,x,y,z,r,m):
 return poly(name,[(x+math.cos(i*math.pi/4)*r*(1 if i%2==0 else .28),y+math.sin(i*math.pi/4)*r*(1 if i%2==0 else .28),z) for i in range(8)],m)
def join(name,objects):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=name
 bpy.context.scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); return o
# Board 0.64m wide, 0.48m deep; top playing surface z=.022.
for side in [-1,1]:
 cx=side*.162
 cube('Case', (cx,0,.008),(.316,.48,.016),plum,.008)
 cube('Gold_Outline',(cx,0,.017),(.313,.476,.004),ivory,.006)
 cube('Upper_Frame',(cx,0,.021),(.307,.470,.008),plum,.006)
 cube('Playing_Field',(side*.139,0,.026),(.218,.414,.002),navy)
 # swirl inlays lie below point decals
 for k in range(3):
  vs=[]
  for j in range(37):
   y=-.204+j*.408/36; x=side*.139+math.sin(y*24+k*2)*.033+(k-1)*.051
   vs.append((x-.009,y,.0271+k*.00008))
  for j in reversed(range(37)):
   y=-.204+j*.408/36; x=side*.139+math.sin(y*24+k*2)*.033+(k-1)*.051
   vs.append((x+.009,y,.0271+k*.00008))
  
  for q in range(36): poly('Felt_Wave',[vs[q],vs[q+1],vs[72-q],vs[73-q]],blue)
 for row in [-1,1]:
  for j in range(6):
   x=side*.139+(j-2.5)*.035
   material=ivory if (j+(row==-1))%2==0 else red
   poly('Point',[(x-.0168,row*.205,.0275),(x+.0168,row*.205,.0275),(x,row*.048,.0275)],material)
 # perimeter rails and tray recesses
 for y in [-.219,.219]: cube('End_Rail',(cx,y,.031),(.300,.025,.019),plum,.003)
 cube('Inner_Bar',(side*.009,0,.031),(.014,.420,.019),plum,.002)
 cube('Outer_Rail',(side*.308,0,.031),(.015,.424,.019),plum,.002)
 cube('Tray_Divider',(side*.258,0,.030),(.009,.422,.016),rim,.002)
 for y in [-.132,.132]:
  cube('Tray_Floor',(side*.282,y,.025),(.036,.161,.003),dark,.003)
 for y in [-.218,0,.218]:cube('Tray_Cross_Rail',(side*.281,y,.032),(.043,.035,.018),plum,.003)
 cube('Badge',(side*.282,0,.042),(.030,.061,.002),ivory,.004)
 star('Badge_Star',side*.282,0,.0432,.012,red)
for y in [-.165,.165]:
 for x in [-.005,.005]:
  cube('Hinge_Leaf',(x,y,.044),(.009,.029,.003),gold,.001)
  for dy in [-.009,.009]:cyl('Hinge_Rivet',(x,y+dy,.046),.0016,.001,gold,12)
board=join('Board',parts[:]); parts=[]
# single reusable checker variants with star and two inset rings
assets=[board]
for name,body,accent in [('Checker_Ivory',ivory,red),('Checker_Red',red,ivory)]:
 cyl('Coin_Body',(0,0,.005),.0157,.010,body)
 cyl('Face_Rim',(0,0,.0102),.0148,.001,accent)
 cyl('Face',(0,0,.0109),.0139,.001,body)
 star('Star',0,0,.0115,.007,accent)
 o=join(name,parts[:]); parts=[]; assets.append(o)
# die: opposite faces sum to seven; modeled dark pip inserts
cube('Die_Body',(0,0,.011),(.022,.022,.022),ivory,.002)
patterns={1:[(0,0)],2:[(-1,-1),(1,1)],3:[(-1,-1),(0,0),(1,1)],4:[(-1,-1),(-1,1),(1,-1),(1,1)],5:[(-1,-1),(-1,1),(0,0),(1,-1),(1,1)],6:[(-1,-1),(-1,0),(-1,1),(1,-1),(1,0),(1,1)]}
for value,normal in [(1,(0,0,1)),(6,(0,0,-1)),(2,(1,0,0)),(5,(-1,0,0)),(3,(0,1,0)),(4,(0,-1,0))]:
 n=Vector(normal); u=Vector((1,0,0)) if n.z else Vector((0,0,1)); v=n.cross(u)
 for a,b in patterns[value]:
  pos=Vector((0,0,.011))+n*.01095+u*a*.005+v*b*.005
  bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=pos); o=bpy.context.object; o.scale=(.0018,.0018,.00038); o.rotation_euler=n.to_track_quat('Z','Y').to_euler(); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); finish(o,'Pip_'+str(value),dark)
dice=join('Die',parts[:]); assets.append(dice); parts=[]
# Export each asset at its own origin; combined library has pieces set beside board.
for obj in assets:
 bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
 bpy.ops.export_scene.gltf(filepath=OUT+'/'+obj.name+'.glb',use_selection=True,export_format='GLB',export_yup=True)
 bpy.ops.export_scene.fbx(filepath=OUT+'/'+obj.name+'.fbx',use_selection=True,axis_forward='-Z',axis_up='Y',apply_unit_scale=True,add_leaf_bones=False,path_mode='COPY',embed_textures=True,object_types={'MESH'})
assets[1].location=(.375,.13,0); assets[2].location=(.375,.065,0); assets[3].location=(.375,-.02,0)
bpy.ops.object.select_all(action='DESELECT')
for o in assets:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT+'/Plakoto_Asset_Library.glb',use_selection=True,export_format='GLB')
# Preview only: floor, lighting and camera excluded from exported assets.
cube('Preview_Ground',(0,0,-.014),(200,200,.01),dark)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.72,-.95,1.22)); camera=bpy.context.object; aim(camera,(.035,0,0)); camera.data.type='ORTHO'; camera.data.ortho_scale=.95; bpy.context.scene.camera=camera
for loc,power,size in [((-.4,-.3,1.2),70,1),((.7,.3,.8),45,.8)]:
 bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.data.energy=power; o.data.shape='DISK'; o.data.size=size; aim(o,(0,0,0))
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=32; sc.render.resolution_x=1500; sc.render.resolution_y=1100; sc.render.resolution_percentage=100; sc.world.color=(.18,.18,.18); sc.view_settings.view_transform='AgX'
bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=OUT+'/Plakoto_Source.blend')
sc.render.filepath=OUT+'/Preview.png'; bpy.ops.render.render(write_still=True)
report={o.name:{'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)} for o in assets}
open(OUT+'/mesh_report.json','w').write(json.dumps(report,indent=2))
print('ASSETS_COMPLETE',report)

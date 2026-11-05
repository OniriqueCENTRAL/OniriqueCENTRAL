# ROCKY en 3D (Blender) : petit caillou rond, cinq pattes potelées à poings, une jointure verte,
# yeux et sourire de braise. Usage : blender -b -P rocky3d.py -- <humeur> <dossier_sortie>
import bpy, sys, math
from mathutils import Vector

mood, out = sys.argv[sys.argv.index("--") + 1:][:2]
N = 24  # images par boucle (2 s à 12 i/s)
TAU = math.tau

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
try: sc.render.engine = "BLENDER_EEVEE"
except TypeError: sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x = sc.render.resolution_y = 256
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.frame_start, sc.frame_end = 0, N - 1
sc.view_settings.view_transform = "Standard"
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.03, 0.03, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

def mat(name, color, rough=0.7, emit=None, stone=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 6
    if stone:  # grès : taches, strates, fissures et relief
        N_, L_ = nt.nodes, nt.links
        def node(t, **kv):
            n = N_.new(t)
            for k, v in kv.items(): n.inputs[k].default_value = v
            return n
        def ramp(c0, c1, p0, p1):
            r = N_.new("ShaderNodeValToRGB"); e = r.color_ramp.elements
            e[0].color, e[1].color, e[0].position, e[1].position = (*c0, 1), (*c1, 1), p0, p1
            return r
        def mix(a, b, f):
            m_ = N_.new("ShaderNodeMix"); m_.data_type = "RGBA"; m_.blend_type = "MULTIPLY"
            ins = {i.identifier: i for i in m_.inputs}; ins["Factor_Float"].default_value = f
            L_.new(a, ins["A_Color"]); L_.new(b, ins["B_Color"])
            return [o for o in m_.outputs if o.identifier == "Result_Color"][0]
        tc = N_.new("ShaderNodeTexCoord").outputs["Object"]
        nz = node("ShaderNodeTexNoise", Scale=3.0, Detail=12.0, Roughness=0.65); L_.new(tc, nz.inputs["Vector"])
        base = ramp(color, tuple(min(1, c * 1.9) for c in color), 0.3, 0.75); L_.new(nz.outputs["Fac"], base.inputs["Fac"])
        wv = node("ShaderNodeTexWave", Scale=1.4, Distortion=2.0, Detail=4.0); L_.new(tc, wv.inputs["Vector"])
        strata = ramp((0.55, 0.5, 0.45), (1, 1, 1), 0.2, 0.6); L_.new(wv.outputs["Fac"], strata.inputs["Fac"])
        vo = N_.new("ShaderNodeTexVoronoi"); vo.feature = "DISTANCE_TO_EDGE"; vo.inputs["Scale"].default_value = 2.6; L_.new(tc, vo.inputs["Vector"])
        crack = ramp((0.08, 0.06, 0.05), (1, 1, 1), 0.0, 0.035); L_.new(vo.outputs["Distance"], crack.inputs["Fac"])
        col = mix(mix(base.outputs["Color"], strata.outputs["Color"], 0.6), crack.outputs["Color"], 1.0)
        L_.new(col, b.inputs["Base Color"])
        grain = node("ShaderNodeTexNoise", Scale=40.0, Detail=10.0); L_.new(tc, grain.inputs["Vector"])
        h = N_.new("ShaderNodeMath"); h.operation = "ADD"
        L_.new(grain.outputs["Fac"], h.inputs[0]); L_.new(crack.outputs["Color"], h.inputs[1])
        bump = node("ShaderNodeBump", Strength=0.6, Distance=0.05); L_.new(h.outputs[0], bump.inputs["Height"]); L_.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m

STONE = mat("stone", (0.36, 0.27, 0.19), 0.9, stone=True)
DARK = mat("dark", (0.26, 0.19, 0.13), 0.9, stone=True)
GREEN = mat("green", (0.18, 0.55, 0.36), 0.5)
EMBER = mat("ember", (1, 0.25, 0.2), 0.4, emit=(1, 0.22, 0.2))
EYE = mat("eye", (0.02, 0.012, 0.01), 0.08)
SHINE = mat("shine", (1, 1, 1), 0.3, emit=(1, 1, 1))
ZMAT = mat("z", (1, 0.85, 0.87), 0.5, emit=(1, 0.8, 0.82))

def obj(add, m, parent=None, loc=(0, 0, 0), scale=(1, 1, 1), smooth=True, **kw):
    add(**kw); o = bpy.context.active_object
    o.data.materials.append(m); o.parent = parent; o.location = loc; o.scale = scale
    if smooth: bpy.ops.object.shade_smooth()
    return o

def empty(parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new("e", None); sc.collection.objects.link(e); e.parent = parent; e.location = loc; return e

root = empty()
# Corps : boule taillée en facettes (ico + Voronoi creusé vers l'intérieur), ombrage plat = arêtes de pierre
body = obj(bpy.ops.mesh.primitive_ico_sphere_add, STONE, root, scale=(1.15, 1.0, 1.0), smooth=False, subdivisions=2)
tex = bpy.data.textures.new("chunks", "VORONOI"); tex.noise_scale = 0.55
d = body.modifiers.new("d", "DISPLACE"); d.texture = tex; d.strength = 0.38; d.mid_level = 1.0
def blocky(o):  # segment de patte = bloc de pierre chanfreiné
    bv = o.modifiers.new("b", "BEVEL"); bv.width = 0.05; bv.segments = 1
    dd = o.modifiers.new("d", "DISPLACE"); dd.texture = tex; dd.strength = 0.04; dd.mid_level = 1.0
    return o

face = empty(body)
eyes = [obj(bpy.ops.mesh.primitive_uv_sphere_add, EYE, face, (x, -0.98, 0.18), (0.11, 0.06, 0.14)) for x in (-0.34, 0.34)]
for e in eyes: obj(bpy.ops.mesh.primitive_uv_sphere_add, SHINE, e, (-0.35, -0.8, 0.4), (0.3, 0.3, 0.3))
bpy.ops.curve.primitive_bezier_curve_add(); smile = bpy.context.active_object
p = smile.data.splines[0].bezier_points
p[0].co, p[0].handle_left, p[0].handle_right = (-0.17, 0, 0.02), (-0.25, 0, 0.08), (-0.1, 0, -0.07)
p[1].co, p[1].handle_left, p[1].handle_right = (0.17, 0, 0.02), (0.1, 0, -0.07), (0.25, 0, 0.08)
smile.data.bevel_depth = 0.025; smile.data.materials.append(EYE)
smile.parent = face; smile.location = (0, -1.02, -0.08)
cheeks = [obj(bpy.ops.mesh.primitive_uv_sphere_add, EMBER, face, (x, -0.93, -0.06), (0.12, 0.03, 0.07)) for x in (-0.58, 0.58)]
for c in cheeks: c.active_material = mat("blush", (0.9, 0.25, 0.3), emit=(0.9, 0.15, 0.22)); c.active_material.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6

# Pattes : un pivot sur le corps (angle dans le plan de l'écran, 0 = droite, 90 = haut) puis un coude.
legs = []
for i in range(5):
    base = empty(root)
    upper = blocky(obj(bpy.ops.mesh.primitive_cube_add, STONE, base, (1.2, 0, 0), (0.3, 0.2, 0.2), smooth=False))
    elbow = empty(base, (1.48, -0.05, 0))
    obj(bpy.ops.mesh.primitive_ico_sphere_add, GREEN if i == 1 else DARK, elbow, scale=(0.25,) * 3, smooth=False, subdivisions=1)
    blocky(obj(bpy.ops.mesh.primitive_cube_add, STONE, elbow, (0.3, 0, 0), (0.25, 0.18, 0.18), smooth=False))
    fist = blocky(obj(bpy.ops.mesh.primitive_cube_add, DARK, elbow, (0.62, 0, 0), (0.2, 0.22, 0.22), smooth=False))
    legs.append((base, elbow))

Z = []
if mood == "sleeping":
    for k in range(3):
        bpy.ops.object.text_add(); t = bpy.context.active_object
        t.data.body = "Z"; t.data.extrude = 0.04; t.data.materials.append(ZMAT)
        t.rotation_euler = (math.pi / 2, 0, 0); Z.append(t)

# Poses : (angle, coude) pour chaque patte.
POSE = {
    "idle":     [(90, 25), (12, -45), (-60, -15), (-120, 15), (168, 45)],
    "happy":    [(90, 10), (40, 35), (-60, -15), (-120, 15), (140, -35)],
    "thinking": [(85, 25), (30, 110), (-60, -15), (-120, 15), (168, 45)],
    "sleeping": [(80, 110), (15, -100), (-50, -95), (-130, 95), (165, 100)],
}[mood]

cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = 4.4
cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, -12, 3.2); cam.rotation_euler = (Vector((0, 0, 0.1)) - cam.location).to_track_quat("-Z", "Y").to_euler()

def light(kind, loc, energy, color, size=3):
    l = bpy.data.lights.new(kind, kind); l.energy = energy; l.color = color
    if kind == "AREA": l.size = size
    o = bpy.data.objects.new(kind, l); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
light("AREA", (-4, -6, 6), 600, (1, 0.88, 0.75), 4)       # lumière principale chaude
light("AREA", (5, -3, 1), 120, (1, 0.85, 0.85), 3)       # débouchage
light("AREA", (0, 5, 3), 1400, (0.89, 0.2, 0.27), 3)     # contre-jour rouge ONIRIQUE

def key(o, *paths):
    for pth in paths: o.keyframe_insert(pth)

for f in range(N):
    sc.frame_set(f); s = math.sin(TAU * f / N); c = math.cos(TAU * f / N)
    blink = 0.12 if mood == "idle" and f in (17, 18) else 1
    eye_z, eye_up, smile_s, rx = 1, 0, 1.35, 0
    if mood == "idle":
        root.location = (0, 0, 0.06 * s); body.scale = (1, 0.9, 0.85 + 0.015 * s)
        wave = [0] * 5; wave[0] = 18 * math.sin(TAU * 2 * f / N) if f < 12 else 0
    elif mood == "happy":
        h = abs(math.sin(TAU * f / N * 2)); root.location = (0, 0, 0.3 * h)
        body.scale = (1 + 0.05 * (1 - h), 0.9, 0.85 - 0.06 * (1 - h))
        wave = [10 * s, 25 * math.sin(TAU * 2 * f / N), 0, 0, -25 * math.sin(TAU * 2 * f / N)]
        eye_z, eye_up, smile_s = 1.2, 0.04, 1.9
    elif mood == "thinking":
        root.location = (0, 0, 0.03 * s); rx = 6
        wave = [0, 12 * math.sin(TAU * 4 * f / N), 0, 0, 0]; eye_up = 0.08
    else:
        root.location = (0, 0, -0.35); body.scale = (1 + 0.03 * s, 0.9, 0.85 - 0.03 * s)
        wave = [3 * s] * 5; eye_z, smile_s = 0.12, 0.9
        for k, t in enumerate(Z):
            ph = (f / N + k / 3) % 1
            t.location = (1.0 + 0.6 * ph + 0.15 * k, -1.2, 0.6 + 1.6 * ph)
            t.scale = (0.35 + 0.35 * ph,) * 3 if ph < 0.85 else (0.001,) * 3
            key(t, "location", "scale")
    root.rotation_euler = (0, math.radians(rx), 0)
    for (base, elbow), (a, b), w in zip(legs, POSE, wave):
        base.rotation_euler = (0, -math.radians(a + w), 0); elbow.rotation_euler = (0, -math.radians(b), 0)
        key(base, "rotation_euler"); key(elbow, "rotation_euler")
    for e in eyes:
        e.scale = (0.11 if eye_z > 0.5 else 0.14, 0.06, 0.14 * eye_z * blink); e.location.z = 0.18 + eye_up; key(e, "scale", "location")
    smile.scale = (smile_s,) * 3
    key(root, "location", "rotation_euler"); key(body, "scale"); key(smile, "scale")

for f in range(N):
    sc.frame_set(f); sc.render.filepath = f"{out}/{mood}_{f:02d}.png"
    bpy.ops.render.render(write_still=True)

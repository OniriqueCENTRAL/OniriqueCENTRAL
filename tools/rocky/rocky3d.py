# ROCKY en 3D (Blender, Cycles) : caillou de grès arrondi aux fissures de braise, cinq pattes de pierre à trois doigts,
# yeux vernis, sourcils de pierre, bouche qui s'ouvre. Chaque animation est rendue image par image en PNG transparent,
# puis pack.py en fait les WebP du site (bulle) et les planches de CLOUD (mini ROCKY bâtisseur).
# Usage : blender -b -P rocky3d.py -- <animation|all> <dossier_sortie> [taille=384] [échantillons=40]
import bpy, sys, math, json
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

args = sys.argv[sys.argv.index("--") + 1:]
which, out = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 384
SAMPLES = int(args[3]) if len(args) > 3 else 40
TAU, rad = math.tau, math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("HIP", "CUDA", "OPTIX", "ONEAPI"):
        try:
            prefs.compute_device_type = kind; prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type != "CPU"]
            if gpus:
                for d in prefs.devices: d.use = True
                sc.cycles.device = "GPU"; break
        except TypeError: pass
except Exception: pass
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "AgX"
try: sc.view_settings.look = "AgX - Medium High Contrast"
except TypeError: pass
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
bg = sc.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.07, 0.045, 0.05, 1); bg.inputs[1].default_value = 0.25

# ---------------------------------------------------------------- matières
def nodes_of(m):
    nt = m.node_tree
    def node(t, **kv):
        n = nt.nodes.new(t)
        for k, v in kv.items(): n.inputs[k].default_value = v
        return n
    def ramp(src, stops, interp="LINEAR"):
        r = nt.nodes.new("ShaderNodeValToRGB"); r.color_ramp.interpolation = interp; e = r.color_ramp.elements
        while len(e) < len(stops): e.new(0.5)
        for el, (p, c) in zip(e, stops): el.position = p; el.color = (*c, 1) if len(c) == 3 else c
        nt.links.new(src, r.inputs["Fac"]); return r.outputs["Color"]
    def mix(a, b, f, blend="MULTIPLY"):
        n = nt.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"; n.blend_type = blend
        ins = {i.identifier: i for i in n.inputs}
        if isinstance(f, float): ins["Factor_Float"].default_value = f
        else: nt.links.new(f, ins["Factor_Float"])
        for slot, v in (("A_Color", a), ("B_Color", b)):
            if isinstance(v, tuple): ins[slot].default_value = (*v, 1)
            else: nt.links.new(v, ins[slot])
        return [o for o in n.outputs if o.identifier == "Result_Color"][0]
    def math_(op, a, b=0.0):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, float): n.inputs[i].default_value = v
            else: nt.links.new(v, n.inputs[i])
        return n.outputs[0]
    return nt, node, ramp, mix, math_

def plain(name, color, rough=0.6, emit=None, strength=4.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough
    if coat: b.inputs["Coat Weight"].default_value = coat; b.inputs["Coat Roughness"].default_value = 0.03
    if emit: b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = strength
    return m

def stone(name, dark, light, scale=1.0, strata=0.55):
    """Grès : deux teintes mêlées, strates, arêtes usées plus claires, creux sombres, grain."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt, node, ramp, mix, math_ = nodes_of(m); L = nt.links
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    mp = node("ShaderNodeMapping", Scale=(scale,) * 3); L.new(tc, mp.inputs["Vector"]); tc = mp.outputs["Vector"]
    nz = node("ShaderNodeTexNoise", Scale=2.6, Detail=10.0, Roughness=0.62); L.new(tc, nz.inputs["Vector"])
    col = ramp(nz.outputs["Fac"], [(0.32, dark), (0.72, light)])
    wv = node("ShaderNodeTexWave", Scale=1.1, Distortion=3.0, Detail=5.0, **{"Detail Scale": 1.5}); L.new(tc, wv.inputs["Vector"])
    col = mix(col, ramp(wv.outputs["Fac"], [(0.15, (0.7, 0.64, 0.6)), (0.65, (1, 1, 1))]), strata)
    spots = node("ShaderNodeTexNoise", Scale=14.0, Detail=4.0); L.new(tc, spots.inputs["Vector"])
    col = mix(col, ramp(spots.outputs["Fac"], [(0.6, (1, 1, 1)), (0.75, (0.62, 0.55, 0.5))]), 1.0)
    # arêtes : plus claires (usées), creux : plus sombres
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    edge = ramp(geo.outputs["Pointiness"], [(0.5, (0, 0, 0)), (0.58, (1, 1, 1))])
    edge_bw = nt.nodes.new("ShaderNodeRGBToBW"); L.new(edge, edge_bw.inputs["Color"])
    col = mix(col, (0.9, 0.76, 0.6), math_("MULTIPLY", edge_bw.outputs["Val"], 0.4), "SCREEN")
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.35
    col = mix(col, ramp(ao.outputs["AO"], [(0.0, (0.35, 0.3, 0.3)), (1.0, (1, 1, 1))]), 1.0)
    grain = node("ShaderNodeTexNoise", Scale=48.0, Detail=8.0); L.new(tc, grain.inputs["Vector"])
    height = grain.outputs["Fac"]
    L.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.86
    bump = node("ShaderNodeBump", Strength=0.45, Distance=0.04); L.new(height, bump.inputs["Height"]); L.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m

def carapace(name, scale=1.0, disp=0.0, embers=0.0, face=False, tone=1.0):
    """Carapace minérale : plaques de roche bombées (teinte propre à chacune), sillons profonds entre elles où la braise
    luit par endroits, fêlures, piqûres, grain, éclats de mica, arêtes usées, creux plus sombres. disp > 0 : vrai relief
    rendu (déplacement Cycles). face : le visage reste une pierre polie, sans plaques ni braise. La valeur « glow » de la
    matière règle l'intensité de la braise image par image."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt, node, ramp, mix, math_ = nodes_of(m); L = nt.links
    b = nt.nodes["Principled BSDF"]; outn = nt.nodes["Material Output"]
    def bw(c):
        n = nt.nodes.new("ShaderNodeRGBToBW"); L.new(c, n.inputs["Color"]); return n.outputs["Val"]
    def rng(v, a, b_, smooth=True):
        n = nt.nodes.new("ShaderNodeMapRange"); n.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
        L.new(v, n.inputs["Value"]); n.inputs["From Min"].default_value = a; n.inputs["From Max"].default_value = b_
        return n.outputs["Result"]
    def vmath(op, a, b_):
        n = nt.nodes.new("ShaderNodeVectorMath"); n.operation = op
        for i, v in enumerate((a, b_)):
            if isinstance(v, tuple): n.inputs[i].default_value = v
            else: L.new(v, n.inputs[i])
        return n.outputs["Value" if op == "DISTANCE" else "Vector"]
    tco = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    tc = vmath("MULTIPLY", tco, (scale,) * 3)
    warp = node("ShaderNodeTexNoise", Scale=1.3, Detail=3.0); L.new(tc, warp.inputs["Vector"])
    wtc = vmath("ADD", tc, vmath("MULTIPLY", vmath("SUBTRACT", warp.outputs["Color"], (0.5, 0.5, 0.5)), (0.35, 0.35, 0.35)))
    f1 = nt.nodes.new("ShaderNodeTexVoronoi"); f1.inputs["Scale"].default_value = 3.3; L.new(wtc, f1.inputs["Vector"])
    ed = nt.nodes.new("ShaderNodeTexVoronoi"); ed.feature = "DISTANCE_TO_EDGE"; ed.inputs["Scale"].default_value = 3.3
    L.new(wtc, ed.inputs["Vector"])
    fine = nt.nodes.new("ShaderNodeTexVoronoi"); fine.feature = "DISTANCE_TO_EDGE"; fine.inputs["Scale"].default_value = 11.0
    L.new(wtc, fine.inputs["Vector"])
    groove = rng(ed.outputs["Distance"], 0.0, 0.055)          # 0 dans le sillon, 1 sur la plaque
    hair = rng(fine.outputs["Distance"], 0.0, 0.03)           # petites fêlures dans les plaques
    dome = math_("SUBTRACT", 1.0, math_("MULTIPLY", f1.outputs["Distance"], 0.7))
    pitn = node("ShaderNodeTexNoise", Scale=9.0, Detail=6.0, Roughness=0.7); L.new(tc, pitn.inputs["Vector"])
    pit = rng(pitn.outputs["Fac"], 0.63, 0.7)
    grain = node("ShaderNodeTexNoise", Scale=70.0, Detail=10.0, Roughness=0.7); L.new(tc, grain.inputs["Vector"])
    fm = side = None
    if face:  # fm : 0 au centre du visage, 1 ailleurs ; side : pas de braise sur la face avant
        fm = rng(vmath("DISTANCE", tco, (0.0, -0.95, 0.06)), 0.3, 0.95)
        xyz = nt.nodes.new("ShaderNodeSeparateXYZ"); L.new(tco, xyz.inputs[0])
        side = rng(xyz.outputs["Y"], -0.7, -0.25)
    def faced(v, flat):
        if fm is None: return v
        n = nt.nodes.new("ShaderNodeMix"); n.data_type = "FLOAT"; L.new(fm, n.inputs["Factor"])
        n.inputs["A"].default_value = flat; L.new(v, n.inputs["B"]); return n.outputs["Result"]
    # relief
    h = math_("ADD", math_("MULTIPLY", groove, 0.55), math_("MULTIPLY", dome, 0.3))
    h = math_("SUBTRACT", h, math_("MULTIPLY", pit, 0.12))
    h = math_("SUBTRACT", h, math_("MULTIPLY", math_("SUBTRACT", 1.0, hair), 0.07))
    h = faced(h, 0.66)
    h = math_("ADD", h, math_("MULTIPLY", grain.outputs["Fac"], 0.06))
    bump = node("ShaderNodeBump", Strength=0.35, Distance=0.02)
    if disp:
        m.displacement_method = "BOTH"
        dn = node("ShaderNodeDisplacement", Midlevel=0.6, Scale=disp); L.new(h, dn.inputs["Height"])
        L.new(dn.outputs["Displacement"], outn.inputs["Displacement"])
        L.new(math_("ADD", grain.outputs["Fac"], math_("MULTIPLY", hair, 0.5)), bump.inputs["Height"])
    else:
        bump.inputs["Strength"].default_value = 0.6; L.new(h, bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    # couleur : chaque plaque sa teinte, marbrures, sillons et piqûres sombres, arêtes usées, creux, mica
    tint = ramp(bw(f1.outputs["Color"]), [(p_, tuple(c * tone for c in c_)) for p_, c_ in ((0.0, (0.15, 0.1, 0.075)), (0.5, (0.3, 0.21, 0.14)), (1.0, (0.44, 0.32, 0.21)))])
    mott = node("ShaderNodeTexNoise", Scale=4.0, Detail=8.0, Roughness=0.6); L.new(tc, mott.inputs["Vector"])
    mott_c = ramp(mott.outputs["Fac"], [(0.3, (0.7, 0.66, 0.62)), (0.7, (1.0, 0.96, 0.9))])
    col = mix(tint, mott_c, 1.0)
    wv = node("ShaderNodeTexWave", Scale=2.2, Distortion=4.0, Detail=4.0); L.new(tc, wv.inputs["Vector"])
    col = mix(col, ramp(wv.outputs["Fac"], [(0.2, (0.8, 0.76, 0.72)), (0.7, (1, 1, 1))]), 0.5)
    if fm is not None:  # visage : une seule teinte chaude et douce
        col = mix(mix((0.3, 0.21, 0.14), mott_c, 1.0), col, fm, "MIX")
    col = mix(col, (0.035, 0.02, 0.02), faced(math_("SUBTRACT", 1.0, groove), 0.0), "MIX")
    col = mix(col, (0.08, 0.05, 0.04), math_("MULTIPLY", math_("ADD", pit, math_("MULTIPLY", math_("SUBTRACT", 1.0, hair), 0.6)), 0.6), "MIX")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    col = mix(col, (0.95, 0.8, 0.62), math_("MULTIPLY", rng(geo.outputs["Pointiness"], 0.52, 0.6), 0.45), "SCREEN")
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.3
    col = mix(col, ramp(ao.outputs["AO"], [(0.0, (0.3, 0.25, 0.25)), (1.0, (1, 1, 1))]), 1.0)
    mica_n = node("ShaderNodeTexVoronoi", Scale=180.0); L.new(tc, mica_n.inputs["Vector"])
    mica = math_("MULTIPLY", rng(mica_n.outputs["Distance"], 0.12, 0.02), rng(grain.outputs["Fac"], 0.55, 0.62))
    col = mix(col, (0.95, 0.86, 0.75), math_("MULTIPLY", mica, 0.7), "MIX")
    L.new(col, b.inputs["Base Color"])
    L.new(math_("MULTIPLY", mica, 0.9), b.inputs["Metallic"])
    L.new(math_("SUBTRACT", math_("ADD", 0.78, math_("MULTIPLY", math_("SUBTRACT", 1.0, groove), 0.18)), math_("MULTIPLY", mica, 0.5)), b.inputs["Roughness"])
    if embers:
        glow = nt.nodes.new("ShaderNodeValue"); glow.name = "glow"; glow.outputs[0].default_value = 1.0
        pn = node("ShaderNodeTexNoise", Scale=1.1, Detail=2.0); L.new(tc, pn.inputs["Vector"])
        e = math_("MULTIPLY", rng(ed.outputs["Distance"], 0.03, 0.0), rng(pn.outputs["Fac"], 0.46, 0.58))
        if side is not None: e = math_("MULTIPLY", e, side)
        heat = ramp(rng(pn.outputs["Fac"], 0.5, 0.7, False), [(0.0, (1.0, 0.07, 0.03)), (1.0, (1.0, 0.32, 0.08))])
        L.new(heat, b.inputs["Emission Color"])
        L.new(math_("MULTIPLY", math_("MULTIPLY", e, embers), glow.outputs[0]), b.inputs["Emission Strength"])
    return m

STONE = carapace("stone", 1.0, disp=0.07, embers=6.0, face=True)
LIMB = carapace("limb", 2.4)
KNUCKLE = carapace("knuckle", 2.4, tone=0.62)
JADE = plain("jade", (0.12, 0.5, 0.32), 0.18, coat=1.0)
EYE = plain("eye", (0.012, 0.008, 0.008), 0.04, coat=1.0)
SHINE = plain("shine", (1, 1, 1), 0.3, emit=(1, 0.97, 0.95), strength=10)
MOUTH = plain("mouth", (0.1, 0.012, 0.018), 0.5)
TONGUE = plain("tongue", (0.75, 0.18, 0.2), 0.45)
BLUSH = plain("blush", (0.9, 0.3, 0.32), 0.6, emit=(1, 0.25, 0.3), strength=0.8)
EMBER = plain("ember", (1, 0.22, 0.25), 0.4, emit=(1, 0.2, 0.24), strength=6)
BONE = plain("bone", (1, 0.9, 0.9), 0.5, emit=(1, 0.85, 0.86), strength=3)

# ---------------------------------------------------------------- objets
def active(): return bpy.context.view_layer.objects.active
def setup(o, m, parent, loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    o.data.materials.append(m); o.parent = parent; o.location = loc; o.scale = scale; o.rotation_euler = rot
    return o
def empty(parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new("e", None); sc.collection.objects.link(e); e.parent = parent; e.location = loc; return e
def smooth(o, angle=40):
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    try: bpy.ops.object.shade_auto_smooth(angle=rad(angle))
    except Exception: bpy.ops.object.shade_smooth()
    o.select_set(False)
def rough(o, strength=0.03, levels=2, scale=0.25):
    s = o.modifiers.new("s", "SUBSURF"); s.subdivision_type = "SIMPLE"; s.levels = s.render_levels = levels
    t = bpy.data.textures.new("n", "CLOUDS"); t.noise_scale = scale
    d = o.modifiers.new("d", "DISPLACE"); d.texture = t; d.strength = strength; d.texture_coords = "LOCAL"
    return o
def cone(m, parent, x0, x1, r0, r1, verts=8):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r0, radius2=r1, depth=x1 - x0)
    o = setup(active(), m, parent, ((x0 + x1) / 2, 0, 0), rot=(0, rad(90), 0)); rough(o, 0.05, 2, 0.35); smooth(o, 35); return o
def pebble(m, parent, loc, scale, sub=2, strength=0.04):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub)
    # échelle appliquée au maillage : la texture garde la même taille de grain que sur le corps et les pattes
    o = setup(active(), m, parent, loc); o.data.transform(__import__("mathutils").Matrix.Diagonal((*scale, 1)))
    k = sum(scale) / 3; rough(o, strength * k, 1, 0.5 * k); smooth(o, 40); return o
def ball(m, parent, loc, scale, seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2)
    o = setup(active(), m, parent, loc, scale); bpy.ops.object.shade_smooth(); return o

root = empty()
spin = empty(root)  # lacet (marche de profil) et inclinaison
body = None
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5)
body = setup(active(), STONE, spin, (0, 0, 0))
# Le visage reste lisse (pierre polie) : les déformations y sont atténuées par un groupe de sommets.
vg = body.vertex_groups.new(name="rough")
front = Vector((0, -1, 0.12)).normalized()
for v in body.data.vertices:
    a = v.co.normalized().dot(front)
    vg.add([v.index], min(1, max(0, (0.86 - a) / 0.3)), "REPLACE")
chunks = bpy.data.textures.new("chunks", "VORONOI"); chunks.noise_scale = 0.78
d = body.modifiers.new("chunks", "DISPLACE"); d.texture = chunks; d.strength = 0.3; d.mid_level = 1.0; d.vertex_group = "rough"
lump = bpy.data.textures.new("lump", "CLOUDS"); lump.noise_scale = 0.55
d = body.modifiers.new("lump", "DISPLACE"); d.texture = lump; d.strength = 0.1; d.vertex_group = "rough"
sub = body.modifiers.new("relief", "SUBSURF"); sub.levels = 0; sub.render_levels = 2
smooth(body, 32)
BODY_SCALE = Vector((1.12, 0.96, 0.98))

face = empty(body)
dg = bpy.context.evaluated_depsgraph_get()
def surface(x, z):
    """Point de la surface du corps vu de face (repère du corps), par lancer de rayon."""
    ev = body.evaluated_get(dg)
    ok, loc, nrm, _ = ev.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)))
    return loc if ok else Vector((x, -0.95, z))

EYE_X, EYE_Z = 0.32, 0.18
eyes, shines = [], []
for sx in (-1, 1):
    p = surface(sx * EYE_X, EYE_Z)
    e = empty(face, (sx * EYE_X, p.y + 0.01, EYE_Z))
    ball(EYE, e, (0, 0, 0), (1, 1, 1))
    shines.append(ball(SHINE, e, (-0.32, -0.75, 0.38), (0.28, 0.2, 0.28), 16))
    eyes.append(e)
brows = []
for sx in (-1, 1):
    p = surface(sx * EYE_X, EYE_Z + 0.26)
    b_ = empty(face, (sx * EYE_X, p.y - 0.01, EYE_Z + 0.27))
    pebble(KNUCKLE, b_, (0, 0, 0), (0.15, 0.06, 0.05), 2, 0.012)
    brows.append(b_)

bpy.ops.curve.primitive_bezier_curve_add(); smile = active()
pts = smile.data.splines[0].bezier_points
pts[0].co, pts[0].handle_left, pts[0].handle_right = (-0.15, 0, 0.03), (-0.22, 0, 0.09), (-0.09, 0, -0.06)
pts[1].co, pts[1].handle_left, pts[1].handle_right = (0.15, 0, 0.03), (0.09, 0, -0.06), (0.22, 0, 0.09)
smile.data.bevel_depth = 0.022; smile.data.bevel_resolution = 4; smile.data.materials.append(EYE)
pm = surface(0, -0.1); smile.parent = face; smile.location = (0, pm.y - 0.02, -0.1)
mouth = empty(face, (0, pm.y + 0.012, -0.12))
ball(MOUTH, mouth, (0, 0, 0), (1, 1, 1))
ball(TONGUE, mouth, (0, -0.25, -0.45), (0.6, 0.5, 0.45), 16)
cheeks = []
for sx in (-1, 1):
    p = surface(sx * 0.56, -0.05)
    cheeks.append(ball(BLUSH, face, (sx * 0.56, p.y + 0.02, -0.05), (0.13, 0.03, 0.075), 24))

# Pattes : pivot au centre (angle dans le plan de l'écran, 0 = droite, 90 = haut), épaule, bras, coude, avant-bras, main.
legs, hands = [], []
for i in range(5):
    base = empty(spin)
    pebble(KNUCKLE, base, (0.96, 0, 0), (0.27, 0.27, 0.27), 2, 0.035)
    cone(LIMB, base, 1.0, 1.46, 0.25, 0.2)
    elbow = empty(base, (1.5, 0, 0))
    if i == 1: ball(JADE, elbow, (0, 0, 0), (0.21, 0.21, 0.21), 24)
    else: pebble(KNUCKLE, elbow, (0, 0, 0), (0.22, 0.22, 0.22), 2, 0.03)
    cone(LIMB, elbow, 0.06, 0.5, 0.2, 0.17)
    wrist = empty(elbow, (0.56, 0, 0))
    pebble(LIMB, wrist, (0.1, 0, 0), (0.23, 0.2, 0.22), 2, 0.035)
    for k, spread in enumerate((-34, 0, 34)):  # trois doigts trapus, en éventail dans le plan de l'écran
        f = empty(wrist, (0.18, 0, 0)); f.rotation_euler = (0, rad(spread), 0)
        pebble(LIMB, f, (0.15, 0, 0), (0.15 - 0.025 * (k != 1), 0.085, 0.08), 2, 0.02)
        pebble(KNUCKLE, f, (0.27 - 0.025 * (k != 1), 0, 0), (0.05, 0.06, 0.055), 1, 0.01)
    legs.append((base, elbow, wrist)); hands.append(wrist)

# Accessoires des humeurs : Z du sommeil, notes de musique, points de réflexion, larme.
def text_obj(s, m):
    bpy.ops.object.text_add(); t = active(); t.data.body = s; t.data.extrude = 0.035; t.data.bevel_depth = 0.01
    t.data.align_x = "CENTER"; t.data.materials.append(m); t.rotation_euler = (rad(90), 0, 0); return t
def note():
    e = empty(root)
    ball(EMBER, e, (0, 0, 0), (0.12, 0.09, 0.09), 20).rotation_euler = (0, rad(25), 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.022, depth=0.42); setup(active(), EMBER, e, (0.1, 0, 0.2))
    bpy.ops.mesh.primitive_cube_add(); setup(active(), EMBER, e, (0.17, 0, 0.36), (0.075, 0.02, 0.035), (0, rad(-25), 0))
    return e
ZS = [text_obj("Z", BONE) for _ in range(3)]
NOTES = [note() for _ in range(3)]
DOTS = [ball(EMBER, root, (0, 0, 0), (0.09,) * 3, 20) for _ in range(3)]
TEAR = ball(plain("tear", (0.6, 0.8, 1), 0.05, emit=(0.5, 0.75, 1), strength=1.5), face, (0, 0, 0), (0.05, 0.04, 0.07), 16)

bpy.ops.mesh.primitive_plane_add(size=30); ground = active(); ground.is_shadow_catcher = True
GROUND_Z = -2.05; ground.location = (0, 0, GROUND_Z)

# ---------------------------------------------------------------- caméra et lumières
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = 6.0
cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
TARGET = Vector((0, 0, -0.05))
cam.location = (0, -14, 2.6); cam.rotation_euler = (TARGET - cam.location).to_track_quat("-Z", "Y").to_euler()

def light(kind, loc, energy, color, size=3.0):
    l = bpy.data.lights.new(kind, kind); l.energy = energy; l.color = color
    if kind == "AREA": l.size = size
    o = bpy.data.objects.new(kind, l); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); return o
light("AREA", (-7, -5, 6), 1100, (1, 0.84, 0.68), 4)     # principale chaude, en haut à gauche
light("AREA", (6, -6, 0.5), 90, (0.75, 0.78, 1), 5)     # débouchage froid
light("AREA", (3, 5, 5), 1300, (1, 0.16, 0.22), 1.5)      # contre-jour braise (ONIRIQUE)
light("AREA", (-4, 5, 2), 500, (1, 0.28, 0.24), 1.5)

# ---------------------------------------------------------------- poses
HOLD = (6, 40)  # la patte qui tient la carte de CLOUD
STAND = [(92, 30), (14, -38), (-64, -14), (-116, 14), (166, 38)]
def pose(**kw):
    p = dict(z=0.0, x=0.0, yaw=0.0, tilt=0.0, sx=1.0, sz=1.0, legs=list(STAND),
             eye=1.0, look=(0.0, 0.0), brow=(0.0, 0.0), brow_z=0.0, smile=1.0, open=0.0, wide=1.0,
             blush=1.0, glow=1.0, zs=None, notes=None, dots=None, tear=None)
    p.update(kw); return p

def wav(t, k=1.0, ph=0.0): return math.sin(TAU * (k * t + ph))
def hop(t, k=1.0): return abs(math.sin(math.pi * k * t))
def blink(f, frames): return 0.1 if f in frames else 1.0

def idle(t, f):
    w = wav(t)
    L = list(STAND); L[0] = (92 + 4 * w, 30 - 6 * w); L[4] = (166 - 3 * w, 38 + 5 * w); L[1] = (14 + 3 * w, -38 - 5 * w)
    return pose(z=0.05 * w, sx=1 - 0.012 * w, sz=1 + 0.018 * w, legs=L, eye=blink(f, (17, 18)), look=(0.03 * wav(t, 1, .25), 0))
def happy(t, f):
    h = hop(t, 2); s = wav(t, 2)
    L = [(90 + 10 * s, 8), (38 + 18 * s, 30), (-62 + 8 * h, -20 - 15 * h), (-118 - 8 * h, 20 + 15 * h), (142 - 18 * s, -30)]
    k = (f / 24) % 1
    return pose(z=0.42 * h, sx=1 + 0.06 * (1 - h) ** 4, sz=1 - 0.08 * (1 - h) ** 4 + 0.04 * h, legs=L, eye=0.85, wide=1.06, brow_z=0.04, glow=1.5 + 0.5 * h,
                smile=1.5, open=0.6, notes=[((k + i / 3) % 1) for i in range(3)])
def thinking(t, f):
    w = wav(t, 2)
    L = list(STAND); L[1] = (-8, 128 + 4 * w)  # patte au menton, qui tapote
    L[0] = (95, 22); L[4] = (168, 44)
    return pose(z=0.03 * wav(t), tilt=7, legs=L, look=(0.1, 0.09), brow=(-16, -6), brow_z=0.03, smile=0.6,
                eye=blink(f, (9,)), glow=1.0 + 0.4 * wav(t, 2), dots=[(t * 3 - i * 0.6) % 3 for i in range(3)])
def sleeping(t, f):
    w = wav(t)
    L = [(70, 120), (20, 95), (-46, -100), (-134, 100), (160, 115)]
    return pose(z=-0.55 + 0.03 * w, tilt=-8, sx=1.03 + 0.025 * w, sz=0.9 - 0.025 * w, legs=L, eye=0.06, smile=0.7,
                open=0.12 + 0.08 * w, brow=(6, -6), glow=0.45 + 0.25 * w, zs=[(t + i / 3) % 1 for i in range(3)])
def wave(t, f):
    w = wav(t, 2)
    L = list(STAND); L[1] = (58 + 6 * w, 40 + 28 * w)  # la patte qui salue
    L[0] = (104, 34); L[4] = (166, 36)
    return pose(z=0.04 * hop(t, 2), tilt=-4, legs=L, eye=0.9, wide=1.05, smile=1.4, open=0.5, brow_z=0.05, glow=1.3)
def talk(t, f):
    o = abs(math.sin(TAU * t * 3)) * 0.8 + 0.1 * abs(wav(t, 5))
    w = wav(t)
    L = list(STAND); L[1] = (30 + 16 * w, -60 + 25 * w); L[4] = (150 - 14 * w, 60 - 20 * w)
    return pose(z=0.03 * wav(t, 2), legs=L, open=o, smile=1.1, brow=(4 * w, -4 * w), brow_z=0.02 * abs(w), eye=blink(f, (20,)))
def sad(t, f):
    w = wav(t)
    L = [(78, 75), (-20, -40), (-70, -8), (-110, 8), (200, 40)]
    return pose(z=-0.12 + 0.02 * w, tilt=3, sz=0.95, legs=L, look=(0, -0.06), brow=(-26, 26), smile=-0.9, eye=0.8, blush=0.3, glow=0.25,
                tear=t)
def walk(t, f):
    s = wav(t); c = math.cos(TAU * t)
    L = [(96 + 8 * s, 30 - 8 * s), HOLD, (-64 + 18 * s, -14 - 16 * max(0, c)), (-116 + 18 * s, 14 + 16 * max(0, -c)), (160 - 14 * s, 44 + 8 * s)]
    return pose(z=0.08 * abs(c), tilt=-4 + 2 * s, legs=L, look=(0.1, 0), open=0.2, smile=1.2)
def work(t, f):
    # Patte du haut : prend une ligne au-dessus, la descend sur la carte (contact au tiers du cycle), revient.
    e = 0.5 - 0.5 * math.cos(math.pi * t / 0.34) if t < 0.34 else (1 + math.cos(math.pi * (t - 0.34) / 0.66)) / 2
    L = list(STAND)
    L[0] = (100 - 62 * e, 40 + 50 * e)
    L[1] = HOLD
    return pose(z=0.03 * e, tilt=-3 * e, legs=L, look=(0.12, 0.05), smile=1.2, open=0.15 * e)
def cheer(t, f):
    h = hop(t, 2)
    L = [(90 + 20 * wav(t, 2), 10 + 10 * h), HOLD, (-60 + 10 * h, -10 - 20 * h), (-120 - 10 * h, 10 + 20 * h), (140 + 15 * wav(t, 2), -20)]
    return pose(z=0.55 * h, sx=1 + 0.07 * (1 - h) ** 4, sz=1 - 0.09 * (1 - h) ** 4 + 0.04 * h, legs=L, eye=0.85, wide=1.06,
                smile=1.6, open=0.7, brow_z=0.05, glow=1.6 + 0.6 * h)
def portrait(t, f):
    p = wave(0.15, 0); p["legs"][1] = (55, 48); return p

ANIMS = {  # nom : (images, pose)
    "idle": (24, idle), "happy": (24, happy), "thinking": (24, thinking), "sleeping": (24, sleeping),
    "wave": (24, wave), "talk": (24, talk), "sad": (24, sad),
    "walk": (12, walk), "work": (12, work), "cheer": (12, cheer), "portrait": (1, portrait),
}

def apply(p, t):
    root.location = (p["x"], 0, p["z"])
    STONE.node_tree.nodes["glow"].outputs[0].default_value = p["glow"]
    spin.rotation_euler = (0, rad(p["tilt"]), rad(p["yaw"]))
    body.scale = (BODY_SCALE.x * p["sx"], BODY_SCALE.y, BODY_SCALE.z * p["sz"])
    for (base, elbow, _), (a, b) in zip(legs, p["legs"]):
        base.rotation_euler = (0, -rad(a), 0); elbow.rotation_euler = (0, -rad(b), 0)
    lx, lz = p["look"]
    for sx, e in zip((-1, 1), eyes):
        e.scale = (0.125 * p["wide"], 0.08, 0.165 * max(0.06, p["eye"]))
        e.location.x = sx * EYE_X + lx; e.location.z = EYE_Z + lz * 0.6 + (0.03 if p["eye"] < 0.7 else 0)
    for sx, br, ang in zip((-1, 1), brows, p["brow"]):
        br.location.z = EYE_Z + 0.27 + p["brow_z"] + lz * 0.3; br.rotation_euler = (0, rad(ang - sx * 8), 0)
        br.location.x = sx * EYE_X + lx * 0.6
    o = p["open"]
    smile.hide_render = o > 0.05
    mouth.hide_render = o <= 0.05
    smile.scale = (1.3, 1, 1.3 * p["smile"]); smile.location.x = lx * 0.5
    mouth.scale = (0.13 + 0.03 * p["smile"], 0.025, 0.03 + 0.12 * o); mouth.location.x = lx * 0.5
    mouth.location.z = -0.13 - 0.05 * o
    for c in cheeks: c.hide_render = p["blush"] < 0.5
    for i, z in enumerate(ZS):
        ph = p["zs"][i] if p["zs"] else None
        z.hide_render = ph is None or ph > 0.88
        if ph is not None:
            z.location = (0.9 + 0.7 * ph + 0.2 * i, -1.5, 0.2 + 1.9 * ph); z.scale = (0.4 + 0.5 * ph,) * 3
            z.rotation_euler = (rad(90), 0, rad(-10 + 20 * ph))
    for i, n in enumerate(NOTES):
        ph = p["notes"][i] if p["notes"] else None
        n.hide_set(False)
        for ch in n.children: ch.hide_render = ph is None or ph > 0.9
        if ph is not None:
            n.location = (-1.2 + 1.2 * i + 0.3 * math.sin(TAU * ph), -1.6, 1.3 + 1.4 * ph); n.scale = (0.7 + 0.6 * min(ph * 3, 1),) * 3
            n.rotation_euler = (0, rad(15 * math.sin(TAU * ph + i)), 0)
    for i, d_ in enumerate(DOTS):
        ph = p["dots"][i] if p["dots"] else None
        d_.hide_render = ph is None
        if ph is not None:
            pulse = max(0, 1 - abs(ph - 0.5) * 2) if ph < 1 else 0
            d_.location = (0.9 + 0.36 * i, -1.6, 1.7 + 0.12 * i); d_.scale = (0.06 + 0.05 * pulse,) * 3
    TEAR.hide_render = p["tear"] is None
    if p["tear"] is not None:
        ph = p["tear"]; TEAR.location = (EYE_X + 0.1, eyes[0].location.y - 0.04, EYE_Z - 0.12 - 0.5 * ph)
        TEAR.scale = (0.05, 0.04, 0.07) if ph < 0.85 else (0.001,) * 3

# Position à l'image des mains (0..1 depuis le coin bas-gauche), pour caler la carte de CLOUD sur la patte qui la tient.
probe = {}
names = list(ANIMS) if which == "all" else which.split(",")
for name in names:
    name, _, only = name.partition("@")  # idle@6 : seulement l'image 6 (aperçu)
    frames, fn = ANIMS[name]
    for f in ([int(only)] if only else range(frames)):
        t = f / frames
        apply(fn(t, f), t)
        bpy.context.view_layer.update()
        if name in ("work", "walk", "cheer"):
            probe.setdefault(name, []).append([list(world_to_camera_view(sc, cam, h.matrix_world.translation))[:2] for h in hands])
        sc.render.filepath = f"{out}/{name}_{f:02d}.png" if frames > 1 else f"{out}/{name}.png"
        bpy.ops.render.render(write_still=True)
if probe:
    with open(f"{out}/hands.json", "w") as fh: json.dump(probe, fh)

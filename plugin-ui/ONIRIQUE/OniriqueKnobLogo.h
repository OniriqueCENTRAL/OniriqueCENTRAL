#pragma once

#include "OniriqueKnob.h"

//==============================================================================
//  Les dix potards dessinés d'après le logo ONIRIQUE (onglet KNOB de l'administration), pour les plugins d'ONIRIQUE :
//
//  - « Ronce » (TUNER) : l'arc pousse des épines comme une ronce ; anneau de métal liquide épineux sur le bouton.
//  - « Orbite » (VERB) : le « O » du logo en anneau blanc lumineux, l'orbite en pointillés qui s'allume, une étoile
//    qui la parcourt.
//  - « Viseur », « Nova », « Épine », « Étoile », « Spectre », « Éclipse », « Constellation », « Sceau » : les autres
//    modèles de l'onglet KNOB (chacun est décrit au-dessus de sa fonction).
//
//  Même appel que le potard commun, par exemple :
//      onirique::ui::drawKnobRonce (g, zone, position, angleDebut, angleFin, accent, bipolaire, survolé);
//
//  Ce fichier se copie tel quel à côté d'OniriqueKnob.h, et ne se modifie qu'ici (plugin-ui/ONIRIQUE/ du dépôt
//  ONIRIQUE CENTRAL).
//==============================================================================
namespace onirique::ui
{
namespace logoknob
{
inline const juce::Colour bone { 0xffFFECEE };

inline juce::Point<float> at (juce::Point<float> c, float r, float a) { return { c.x + r * std::sin (a), c.y - r * std::cos (a) }; }

/** Plusieurs passes de plus en plus larges et transparentes : la lueur d'un trait. */
inline void glow (juce::Graphics& g, const juce::Path& p, juce::Colour c, float width, float blur)
{
    for (int i = 3; i >= 1; --i)
    {
        g.setColour (c.withMultipliedAlpha (0.22f / (float) i));
        g.strokePath (p, juce::PathStrokeType (width + blur * 0.45f * (float) i, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
}

inline void stroke (juce::Graphics& g, const juce::Path& p, juce::Colour c, float width, float blur = 0.0f)
{
    if (blur > 0.0f) glow (g, p, c, width, blur);
    g.setColour (c);
    g.strokePath (p, juce::PathStrokeType (width, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
}

inline void segment (juce::Graphics& g, juce::Point<float> a, juce::Point<float> b, juce::Colour c, float width, float blur = 0.0f)
{
    juce::Path p;
    p.startNewSubPath (a);
    p.lineTo (b);
    stroke (g, p, c, width, blur);
}

inline void arc (juce::Graphics& g, juce::Point<float> c, float r, float a0, float a1, juce::Colour col, float width, float blur = 0.0f)
{
    if (a1 - a0 < 1.0e-3f) return;
    juce::Path p;
    p.addCentredArc (c.x, c.y, r, r, 0.0f, a0, a1, true);
    stroke (g, p, col, width, blur);
}

/** L'étoile du logo, pleine, avec sa lueur. */
inline void star (juce::Graphics& g, juce::Point<float> c, float r, juce::Colour col, float blur)
{
    const auto p = knobStar (c, r);
    if (blur > 0.0f) glow (g, p, col, 0.0f, blur);
    g.setColour (col);
    g.fillPath (p);
}

/** Le corps : un disque sombre éclairé d'en haut à gauche, ombre dessous, lueur douce au survol. */
inline void body (juce::Graphics& g, juce::Point<float> c, float r, juce::Colour accent, bool hover)
{
    using namespace juce;
    const auto disc = Rectangle<float> (2.0f * r, 2.0f * r).withCentre (c);
    if (hover)
        for (int q = 3; q >= 1; --q)
        {
            g.setColour (accent.withAlpha (0.07f / (float) q));
            g.fillEllipse (disc.expanded (r * 0.08f * (float) q));
        }
    for (int q = 3; q >= 1; --q)
    {
        g.setColour (Colours::black.withAlpha (0.18f));
        g.fillEllipse (disc.translated (0.0f, r * 0.08f).expanded (r * 0.04f * (float) q));
    }
    ColourGradient grad (Colour (0xff36161a), c.x - r * 0.35f, c.y - r * 0.4f, Colour (0xff080405), c.x + r * 0.65f, c.y + r * 0.6f, true);
    grad.addColour (0.6, Colour (0xff160a0c));
    g.setGradientFill (grad);
    g.fillEllipse (disc);
    g.setColour (Colour (255, 220, 225).withAlpha (0.08f));
    g.drawEllipse (disc.reduced (0.5f), 1.0f);
}

/** Les bornes allumées : de l'origine (le milieu pour un réglage bipolaire) à la valeur. */
struct Span { float lo, hi; bool contains (float t) const { return t >= lo - 1.0e-4f && t <= hi + 1.0e-4f && hi - lo > 0.002f; } };
inline Span span (float pos, bool bipolar) { const float from = bipolar ? 0.5f : 0.0f; return { juce::jmin (from, pos), juce::jmax (from, pos) }; }

/** Une épine : un trapèze effilé le long du rayon d'angle `a`, de r1 (largeur w1) à r2 (largeur w2). */
inline void addThorn (juce::Path& p, juce::Point<float> c, float a, float r1, float r2, float w1, float w2)
{
    const float sx = std::sin (a), cy = std::cos (a);
    const auto pt = [&] (float r, float side) { return juce::Point<float> (c.x + r * sx + side * cy, c.y - r * cy + side * sx); };
    p.startNewSubPath (pt (r1, w1 * 0.5f));
    p.lineTo (pt (r2, w2 * 0.5f));
    p.lineTo (pt (r2, -w2 * 0.5f));
    p.lineTo (pt (r1, -w1 * 0.5f));
    p.closeSubPath();
}

/** La lueur d'un trait ou d'un contour, d'intensité 0 à 1 (celle de « Ronce »). */
inline void glowStroke (juce::Graphics& g, const juce::Path& p, juce::Colour c, float width, float intensity)
{
    if (intensity <= 0.003f || p.isEmpty()) return;
    for (int i = 3; i >= 1; --i)
    {
        g.setColour (c.withAlpha (intensity * 0.16f / (float) i));
        g.strokePath (p, juce::PathStrokeType (width * (1.0f + 1.6f * (float) i), juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
}
} // namespace logoknob

/** « Orbite » : le « O » du logo en anneau blanc lumineux ; l'orbite en pointillés s'allume jusqu'à la valeur,
    une étoile la parcourt. */
inline void drawKnobOrbite (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                            juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    const float d = jmin (area.getWidth(), area.getHeight());
    if (d < 8.0f) return;
    const auto c = area.getCentre();
    const float R = d * 0.36f, k = R / 60.0f;   // les traits sont dessinés pour R = 60
    const float pos = jlimit (0.0f, 1.0f, position);
    const auto lit = span (pos, bipolar);
    const auto angle = [&] (float t) { return startAngle + (endAngle - startAngle) * t; };
    const float a = angle (pos);

    // l'orbite en pointillés : pâle sur toute la course, allumée de l'origine à la valeur
    const auto dotted = [&] (float a0, float a1, Colour col, float width, float blur)
    {
        if (a1 - a0 < 1.0e-3f) return;
        Path orbit, dashes;
        orbit.addCentredArc (c.x, c.y, R, R, 0.0f, a0, a1, true);
        const float dash[] = { 3.0f * k, 5.0f * k };
        PathStrokeType (width).createDashedStroke (dashes, orbit, dash, 2);
        if (blur > 0.0f)
            for (int i = 3; i >= 1; --i)
            {
                g.setColour (col.withMultipliedAlpha (0.22f / (float) i));
                g.strokePath (dashes, PathStrokeType (blur * 0.45f * (float) i, PathStrokeType::curved, PathStrokeType::rounded));
            }
        g.setColour (col);
        g.fillPath (dashes);
    };
    dotted (startAngle, endAngle, bone.withAlpha (0.3f), 2.0f * k, 0.0f);
    dotted (angle (lit.lo), angle (lit.hi), accent, 2.6f * k, 10.0f * k);
    for (const float side : { -MathConstants<float>::halfPi, MathConstants<float>::halfPi })
        segment (g, at (c, R + 4.0f * k, side), at (c, R + 14.0f * k, side), bone.withAlpha (0.3f), 1.5f * k);

    // le « O » du logo : un anneau blanc épais et lumineux autour du corps
    body (g, c, R * 0.5f, accent, hover);
    Path ring;
    ring.addEllipse (Rectangle<float> (1.12f * R, 1.12f * R).withCentre (c));
    stroke (g, ring, bone, R * 0.11f, R * 0.28f);

    segment (g, at (c, R * 0.12f, a), at (c, R * 0.4f, a), accent, 2.2f * k, 6.0f * k);
    star (g, at (c, R, a), R * 0.1f, bone, 10.0f * k);
}

/** « Ronce » : l'arc pousse des épines comme une ronce ; le bouton porte un anneau de métal liquide épineux qui
    tourne avec le réglage, et une épine rouge pour aiguille. Mesures données pour un potard de 240 px. */
inline void drawKnobRonce (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                           juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using logoknob::addThorn;
    using logoknob::glowStroke;

    const auto size = jmin (area.getWidth(), area.getHeight());
    if (size < 8.0f)
        return;

    const auto c = area.getCentre();
    const float s = size / 240.0f;
    const float angle = startAngle + jlimit (0.0f, 1.0f, position) * (endAngle - startAngle);
    const float origin = bipolar ? (startAngle + endAngle) * 0.5f : startAngle;
    const float lo = jmin (origin, angle), hi = jmax (origin, angle);
    const bool any = hi - lo > 0.001f;
    const bool down = bipolar && angle < origin;
    const auto hot = accent.interpolatedWith (Colours::white, 0.38f);
    const auto pale = Colour (0xffFFD2D6), silver = Colour (0xffF2E2E4);
    const bool small = size < 62.0f;
    const float glowAmt = hover ? 1.0f : 0.7f;

    // ---- la piste, puis l'arc allumé et sa lueur
    const float rA = 98.0f * s, arcW = jmax (1.2f, 2.6f * s);
    Path track;
    track.addCentredArc (c.x, c.y, rA, rA, 0.0f, startAngle, endAngle, true);
    g.setColour (pale.withAlpha (0.08f));
    g.strokePath (track, PathStrokeType (jmax (1.0f, 2.0f * s), PathStrokeType::curved, PathStrokeType::rounded));

    Path lit;
    if (any)
    {
        lit.addCentredArc (c.x, c.y, rA, rA, 0.0f, lo, hi, true);
        glowStroke (g, lit, accent, arcW, glowAmt);
    }

    // ---- les épines de la ronce : une sur deux vers l'extérieur, les autres vers l'intérieur
    const int count = small ? 10 : 20;
    Path off, on, near;
    for (int i = 0; i <= count; ++i)
    {
        const float a = startAngle + (float) i / (float) count * (endAngle - startAngle);
        const bool outward = i % 2 == 0;
        const bool isLit = any && a >= lo - 1.0e-4f && a <= hi + 1.0e-4f;
        const float closeness = (down ? (hi - a) : (a - lo)) / jmax (1.0e-4f, hi - lo);
        Path& dst = ! isLit ? off : (closeness > 0.8f ? near : on);
        if (outward) addThorn (dst, c, a, 99.0f * s, 112.0f * s, jmax (1.6f, 4.0f * s), 0.25f * s);
        else         addThorn (dst, c, a, 97.0f * s, 88.0f * s, jmax (1.3f, 3.2f * s), 0.25f * s);
    }
    g.setColour (pale.withAlpha (0.14f));
    g.fillPath (off);
    if (any)
    {
        glowStroke (g, on, accent, 1.2f * s, glowAmt * 0.8f);
        glowStroke (g, near, accent, 1.2f * s, glowAmt);
        g.setColour (accent);
        g.strokePath (lit, PathStrokeType (arcW, PathStrokeType::curved, PathStrokeType::rounded));
        g.fillPath (on);
        g.setColour (hot);
        g.fillPath (near);
    }

    // ---- le corps : ombre portée, disque noir éclairé d'en haut à gauche
    const float rB = 72.0f * s;
    {
        const auto sc = c.translated (0.0f, 6.0f * s);
        ColourGradient shadow (Colours::black.withAlpha (0.6f), sc.x, sc.y, Colours::black.withAlpha (0.0f), sc.x + rB * 1.22f, sc.y, true);
        g.setGradientFill (shadow);
        g.fillEllipse (Rectangle<float> (2.44f * rB, 2.44f * rB).withCentre (sc));
    }
    const auto disc = Rectangle<float> (2.0f * rB, 2.0f * rB).withCentre (c);
    ColourGradient face (Colour (0xff24110f), c.x - rB * 0.16f, c.y - rB * 0.40f, Colour (0xff070304), c.x + rB * 0.75f, c.y + rB * 0.85f, true);
    face.addColour (0.55, Colour (0xff10070a));
    g.setGradientFill (face);
    g.fillEllipse (disc);
    g.setColour (Colours::black.withAlpha (0.8f));
    g.drawEllipse (disc, jmax (1.0f, s));

    // ---- l'anneau de métal liquide (il tourne avec le réglage), ses épines et sa lueur blanche
    Path ring;
    {
        const int n = small ? 48 : 96;
        for (int pass = 0; pass < 2; ++pass)
        {
            for (int q = 0; q <= n; ++q)
            {
                const float th = (float) q / (float) n * MathConstants<float>::twoPi;
                const float r = pass == 0 ? 64.0f + 1.6f * std::sin (4.0f * th + 0.5f) + 1.0f * std::sin (9.0f * th)
                                          : 60.0f + 1.2f * std::sin (1.0f - 6.0f * th);
                const float t = angle + (pass == 0 ? th : -th);
                const Point<float> p (c.x + r * s * std::sin (t), c.y - r * s * std::cos (t));
                if (q == 0) ring.startNewSubPath (p); else ring.lineTo (p);
            }
            ring.closeSubPath();
        }
        ring.setUsingNonZeroWinding (false);
    }
    Path vineThorns;
    {
        const float where[] { 45.0f, 100.0f, 160.0f, 215.0f, 280.0f, 330.0f };
        for (int i = 0; i < 6; ++i)
        {
            const float a = angle + degreesToRadians (where[i]);
            if (i % 2 == 1) addThorn (vineThorns, c, a, 64.0f * s, 73.0f * s, 3.2f * s, 0.25f * s);
            else            addThorn (vineThorns, c, a, 61.0f * s, 53.0f * s, 3.0f * s, 0.25f * s);
        }
    }
    glowStroke (g, ring, Colours::white, 3.0f * s, hover ? 0.55f : 0.4f);
    g.setColour (silver);
    g.fillPath (ring);
    g.fillPath (vineThorns);

    // ---- l'aiguille : une épine rouge de l'anneau vers le centre
    Path needle;
    addThorn (needle, c, angle, 60.0f * s, 30.0f * s, jmax (1.8f, 4.2f * s), 0.3f * s);
    glowStroke (g, needle, accent, 2.0f * s, glowAmt);
    g.setColour (hot);
    g.fillPath (needle);
}

/** « Viseur » : la croix de visée du logo. */
inline void drawKnobViseur (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                            juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    const float d = jmin (area.getWidth(), area.getHeight());
    if (d < 8.0f) return;
    const auto c = area.getCentre();
    const float R = d * 0.36f, k = R / 60.0f;   // les traits sont dessinés pour R = 60
    const float pos = jlimit (0.0f, 1.0f, position);
    const auto lit = span (pos, bipolar);
    const auto angle = [&] (float t) { return startAngle + (endAngle - startAngle) * t; };
    const float a = angle (pos);

    // l'orbite en pointillés, puis l'arc de valeur
    {
        Path ring, dots;
        ring.addEllipse (Rectangle<float> (2.04f * R, 2.04f * R).withCentre (c));
        const float dash[] = { 1.0f * k, 5.0f * k };
        PathStrokeType (1.3f * k).createDashedStroke (dots, ring, dash, 2);
        g.setColour (bone.withAlpha (0.3f));
        g.fillPath (dots);
    }
    arc (g, c, R * 0.9f, angle (lit.lo), angle (lit.hi), accent, 2.6f * k, 12.0f * k);

    body (g, c, R * 0.6f, accent, hover);
    g.setColour (bone.withAlpha (0.65f));
    g.drawEllipse (Rectangle<float> (1.12f * R, 1.12f * R).withCentre (c), 1.2f * k);

    // les trois autres branches de la croix, puis la branche haute qui traverse l'arc
    for (int q = 1; q < 4; ++q)
    {
        const float b = a + (float) q * MathConstants<float>::halfPi;
        segment (g, at (c, R * 0.58f, b), at (c, R * 0.78f, b), bone.withAlpha (0.4f), 1.3f * k);
    }
    segment (g, at (c, R * 0.22f, a), at (c, R * 1.12f, a), bone, 1.6f * k, 8.0f * k);
    star (g, at (c, R * 1.14f, a), R * 0.07f, bone, 10.0f * k);
    star (g, c, R * 0.08f, bone.withAlpha (0.8f), 4.0f * k);
}

/** « Nova » : des rayons qui partent du centre. */
inline void drawKnobNova (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                          juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    const float d = jmin (area.getWidth(), area.getHeight());
    if (d < 8.0f) return;
    const auto c = area.getCentre();
    const float R = d * 0.36f, k = R / 60.0f;
    const float pos = jlimit (0.0f, 1.0f, position);
    const auto lit = span (pos, bipolar);
    const auto angle = [&] (float t) { return startAngle + (endAngle - startAngle) * t; };
    const float a = angle (pos);

    arc (g, c, R, startAngle, endAngle, bone.withAlpha (0.1f), 1.5f * k);
    arc (g, c, R, angle (lit.lo), angle (lit.hi), accent, 3.0f * k, 12.0f * k);
    for (int i = 0; i <= 6; ++i)
    {
        const float u = (float) i / 6.0f;
        const bool on = lit.contains (u);
        star (g, at (c, R * 1.16f, angle (u)), R * 0.05f, on ? accent : bone.withAlpha (0.35f), on ? 6.0f * k : 0.0f);
    }

    body (g, c, R * 0.72f, accent, hover);
    for (int i = 0; i < 8; ++i)
        segment (g, c, at (c, R * (i % 2 ? 0.45f : 0.62f), a + MathConstants<float>::pi * (0.125f + 0.25f * (float) i)), bone.withAlpha (0.3f), 1.0f * k);

    // le rayon principal, de l'os pâle au centre vers la couleur du réglage
    const auto end = at (c, R * 1.08f, a);
    Path ray;
    ray.startNewSubPath (c);
    ray.lineTo (end);
    glow (g, ray, accent, 2.0f * k, 10.0f * k);
    g.setGradientFill (ColourGradient (bone, c, accent, end, false));
    g.strokePath (ray, PathStrokeType (2.0f * k, PathStrokeType::curved, PathStrokeType::rounded));
    star (g, c, R * 0.12f, bone, 10.0f * k);
}

namespace logoknob
{
/** Le cadre commun des modèles dessinés pour R = 60 (les traits sont multipliés par k). */
struct Frame
{
    juce::Point<float> c;
    float R, k, pos, a;
    Span lit;
    float start, end;
    float angle (float t) const { return start + (end - start) * t; }
};

inline bool frame (Frame& f, juce::Rectangle<float> area, float position, float startAngle, float endAngle, bool bipolar)
{
    const float d = juce::jmin (area.getWidth(), area.getHeight());
    if (d < 8.0f) return false;
    f.c = area.getCentre();
    f.R = d * 0.36f; f.k = f.R / 60.0f;
    f.pos = juce::jlimit (0.0f, 1.0f, position);
    f.lit = span (f.pos, bipolar);
    f.start = startAngle; f.end = endAngle;
    f.a = f.angle (f.pos);
    return true;
}

/** Un triangle effilé de `from` (base de demi-largeur w) à la pointe `to`. */
inline void addSpike (juce::Path& p, juce::Point<float> from, juce::Point<float> to, float w)
{
    const auto dir = to - from;
    const float len = juce::jmax (1.0e-4f, dir.getDistanceFromOrigin());
    const juce::Point<float> n (-dir.y / len * w, dir.x / len * w);
    p.startNewSubPath (from + n);
    p.lineTo (to);
    p.lineTo (from - n);
    p.closeSubPath();
}

/** L'étoile du logo tournée d'un angle. */
inline void starRotated (juce::Graphics& g, juce::Point<float> c, float r, float rotation, juce::Colour col, float blur)
{
    auto p = knobStar (c, r);
    p.applyTransform (juce::AffineTransform::rotation (rotation, c.x, c.y));
    if (blur > 0.0f) glow (g, p, col, 0.0f, blur);
    g.setColour (col);
    g.fillPath (p);
}

/** Un anneau irrégulier comme du métal liquide, avec sa lueur blanche. */
inline void liquidRing (juce::Graphics& g, juce::Point<float> c, float r, float seed, float width)
{
    juce::Path p;
    for (int i = 0; i <= 120; ++i)
    {
        const float a = (float) i / 120.0f * juce::MathConstants<float>::twoPi;
        const float m = 1.0f + 0.07f * std::sin (3.0f * a + seed) + 0.045f * std::sin (5.0f * a + seed * 2.3f) + 0.03f * std::sin (9.0f * a + seed * 0.7f);
        const auto q = at (c, r * m, a);
        if (i == 0) p.startNewSubPath (q); else p.lineTo (q);
    }
    p.closeSubPath();
    stroke (g, p, bone, width, width * 3.0f);
}
} // namespace logoknob

/** « Épine » : graduations en épines effilées comme les branches du logo, aiguille en longue épine courbée. */
inline void drawKnobEpine (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                           juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    const auto c = f.c; const float R = f.R, k = f.k, a = f.a;

    body (g, c, R * 0.66f, accent, hover);
    const int n = R < 22.0f ? 19 : 37;
    Path on, off;
    for (int i = 0; i < n; ++i)
    {
        const float u = (float) i / (float) (n - 1), b = f.angle (u);
        addSpike (f.lit.contains (u) ? on : off, at (c, R * 0.75f, b), at (c, R * (i % 4 == 0 ? 1.04f : 0.94f), b), 1.8f * k);
    }
    g.setColour (bone.withAlpha (0.22f));
    g.fillPath (off);
    glow (g, on, accent, 0.0f, 8.0f * k);
    g.setColour (accent);
    g.fillPath (on);

    // l'aiguille : une épine qui se courbe du centre vers la valeur
    const auto tip = at (c, R * 0.7f, a), side = at (c, R * 0.35f, a - 0.12f);
    const auto n1 = at (c, 4.0f * k, a + MathConstants<float>::halfPi), n2 = at (c, 4.0f * k, a - MathConstants<float>::halfPi);
    Path needle;
    needle.startNewSubPath (n1);
    needle.quadraticTo (side, tip);
    needle.lineTo (n2);
    needle.closeSubPath();
    glow (g, needle, accent, 0.0f, 12.0f * k);
    g.setGradientFill (ColourGradient (accent.interpolatedWith (Colours::white, 0.45f), c, accent.interpolatedWith (Colours::white, 0.8f), tip, false));
    g.fillPath (needle);
    const auto cap = Rectangle<float> (0.14f * R, 0.14f * R).withCentre (c);
    g.setColour (Colour (0xff050203));
    g.fillEllipse (cap);
    g.setColour (bone.withAlpha (0.25f));
    g.drawEllipse (cap, jmax (0.6f, k));
}

/** « Étoile » : la grande étoile à quatre branches du logo sert d'aiguille ; une petite étoile brille au bout de l'arc. */
inline void drawKnobEtoile (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                            juce::Colour accent, bool bipolar, bool hover)
{
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    arc (g, f.c, f.R, f.start, f.end, bone.withAlpha (0.12f), 3.0f * f.k);
    arc (g, f.c, f.R, f.angle (f.lit.lo), f.angle (f.lit.hi), accent, 3.0f * f.k, 12.0f * f.k);
    body (g, f.c, f.R * 0.74f, accent, hover);
    star (g, at (f.c, f.R, f.a), f.R * 0.09f, bone, 10.0f * f.k);
    starRotated (g, f.c, f.R * 0.44f, f.a, bone, 16.0f * f.k);
}

/** « Spectre » : tout en blanc lumineux comme le logo ; anneau de métal liquide irrégulier, épine vers le centre. */
inline void drawKnobSpectre (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                             juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    const auto c = f.c; const float R = f.R, k = f.k;
    const auto disc = Rectangle<float> (1.64f * R, 1.64f * R).withCentre (c);
    if (hover)
    {
        g.setColour (accent.withAlpha (0.08f));
        g.fillEllipse (disc.expanded (R * 0.1f));
    }
    g.setColour (Colour (20, 8, 10).withAlpha (0.9f));
    g.fillEllipse (disc);
    g.setColour (bone.withAlpha (0.08f));
    g.drawEllipse (disc, 6.0f * k);
    liquidRing (g, c, R * 0.58f, 1.3f + f.pos * 2.0f, R * 0.1f);
    segment (g, at (c, R * 1.02f, f.a), at (c, R * 0.42f, f.a), bone, 1.6f * k, 6.0f * k);
    star (g, at (c, R * 1.06f, f.a), R * 0.09f, bone, 10.0f * k);
}

/** « Éclipse » : un disque noir cerné d'une couronne blanche ; les rayons du soleil s'allongent et s'allument
    jusqu'à la valeur. */
inline void drawKnobEclipse (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                             juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    const auto c = f.c; const float R = f.R, k = f.k;
    const int n = R < 22.0f ? 60 : 120;
    Path on, off;
    for (int i = 0; i < n; ++i)
    {
        const float b = (float) i / (float) n * MathConstants<float>::twoPi;
        float rel = std::fmod (b - f.start, MathConstants<float>::twoPi);
        if (rel < 0.0f) rel += MathConstants<float>::twoPi;
        const float u = rel / (f.end - f.start);
        const bool isLit = u <= 1.0f && f.lit.contains (u);
        const float len = (isLit ? 0.3f : 0.1f) * (0.6f + 0.4f * std::abs (std::sin ((float) i * 7.31f)));
        Path& dst = isLit ? on : off;
        dst.startNewSubPath (at (c, R * 0.73f, b));
        dst.lineTo (at (c, R * (0.73f + len), b));
    }
    stroke (g, off, bone.withAlpha (0.45f), 1.0f * k, 3.0f * k);
    stroke (g, on, bone, 1.4f * k, 6.0f * k);
    const auto disc = Rectangle<float> (1.4f * R, 1.4f * R).withCentre (c);
    if (hover)
    {
        g.setColour (accent.withAlpha (0.1f));
        g.fillEllipse (disc.expanded (R * 0.08f));
    }
    g.setColour (Colours::black);
    g.fillEllipse (disc);
    Path rim;
    rim.addEllipse (disc);
    stroke (g, rim, bone, 2.0f * k, 16.0f * k);
    star (g, at (c, R * 0.7f, f.a), R * 0.1f, bone, 10.0f * k);
}

/** « Constellation » : les graduations sont des étoiles reliées par un fil, une constellation qui s'allume ; une
    étoile parcourt l'orbite. */
inline void drawKnobConstellation (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                                   juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    const auto c = f.c; const float R = f.R, k = f.k;

    body (g, c, R * 0.62f, accent, hover);
    {
        Path orbit, dots;
        orbit.addEllipse (Rectangle<float> (R, R).withCentre (c));
        const float dash[] = { 1.0f * k, 4.0f * k };
        PathStrokeType (1.2f * k).createDashedStroke (dots, orbit, dash, 2);
        g.setColour (accent.withAlpha (0.4f));
        g.fillPath (dots);
    }
    g.setColour (bone.withAlpha (0.35f));
    for (int i = 0; i < 6; ++i)
    {
        const auto p = at (c, R * (0.12f + 0.07f * (float) i), (float) i * 2.4f);
        g.fillRect (p.x, p.y, 1.4f * k, 1.4f * k);
    }
    constexpr int n = 11;
    Point<float> pts[n];
    for (int i = 0; i < n; ++i)
        pts[i] = at (c, R * (i % 2 ? 0.97f : 1.03f), f.angle ((float) i / (float) (n - 1)));
    for (int i = 1; i < n; ++i)
    {
        const bool isLit = f.lit.contains ((float) (i - 1) / (float) (n - 1)) && f.lit.contains ((float) i / (float) (n - 1));
        segment (g, pts[i - 1], pts[i], isLit ? accent : bone.withAlpha (0.16f), 1.0f * k, isLit ? 6.0f * k : 0.0f);
    }
    for (int i = 0; i < n; ++i)
    {
        const bool isLit = f.lit.contains ((float) i / (float) (n - 1));
        star (g, pts[i], R * (i % 5 == 0 ? 0.075f : 0.055f), isLit ? bone : bone.withAlpha (0.4f), isLit ? 8.0f * k : 0.0f);
    }
    star (g, at (c, R * 0.62f, f.a), R * 0.09f, accent.interpolatedWith (Colours::white, 0.7f), 12.0f * k);
}

/** « Sceau » : un sceau gravé, cercles, petit « O » au centre et quatre étoiles ; l'étoile du haut sert d'aiguille. */
inline void drawKnobSceau (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
                           juce::Colour accent, bool bipolar, bool hover)
{
    using namespace juce;
    using namespace logoknob;
    using logoknob::bone;   // certains plugins ont aussi un onirique::ui::bone
    Frame f;
    if (! frame (f, area, position, startAngle, endAngle, bipolar)) return;
    const auto c = f.c; const float R = f.R, k = f.k;
    arc (g, c, R, f.start, f.end, bone.withAlpha (0.1f), 1.5f * k);
    arc (g, c, R, f.angle (f.lit.lo), f.angle (f.lit.hi), accent, 3.0f * k, 12.0f * k);
    body (g, c, R * 0.8f, accent, hover);
    g.setColour (bone.withAlpha (0.11f));
    for (const float m : { 0.72f, 0.6f, 0.44f })
        g.drawEllipse (Rectangle<float> (2.0f * m * R, 2.0f * m * R).withCentre (c), 1.2f * k);
    Path o;
    o.addEllipse (Rectangle<float> (0.2f * R, 0.2f * R).withCentre (c));
    stroke (g, o, bone, 2.0f * k, 8.0f * k);
    for (int q = 3; q >= 0; --q)
        star (g, at (c, R * 0.52f, f.a + (float) q * MathConstants<float>::halfPi), R * (q ? 0.06f : 0.09f),
              q ? bone.withAlpha (0.45f) : accent, q ? 0.0f : 10.0f * k);
}

} // namespace onirique::ui

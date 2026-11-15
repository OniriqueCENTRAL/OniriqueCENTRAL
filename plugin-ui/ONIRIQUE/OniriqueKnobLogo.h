#pragma once

#include "OniriqueKnob.h"

//==============================================================================
//  Deux potards dessinés d'après le logo ONIRIQUE (onglet KNOB de l'administration), pour les plugins d'ONIRIQUE :
//
//  - « Ronce » (TUNER) : l'arc pousse des épines comme une ronce ; anneau de métal liquide épineux sur le bouton.
//  - « Orbite » (VERB) : le « O » du logo en anneau blanc lumineux, l'orbite en pointillés qui s'allume, une étoile
//    qui la parcourt.
//
//  Même appel que le potard commun :
//      onirique::ui::drawKnobRonce  (g, zone, position, angleDebut, angleFin, accent, bipolaire, survolé);
//      onirique::ui::drawKnobOrbite (g, zone, position, angleDebut, angleFin, accent, bipolaire, survolé);
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

} // namespace onirique::ui

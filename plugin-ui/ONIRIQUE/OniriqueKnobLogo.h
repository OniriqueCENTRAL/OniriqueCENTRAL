#pragma once

#include "OniriqueKnob.h"

//==============================================================================
//  Deux potards dessinés d'après le logo ONIRIQUE (onglet KNOB de l'administration), pour les plugins d'ONIRIQUE :
//
//  - « Viseur » (TUNER) : les lignes de visée du logo, une croix qui tourne ; sa branche haute traverse l'arc
//    comme un trait de lumière, une étoile à son bout.
//  - « Nova » (VERB) : des rayons partent du centre ; le rayon principal traverse l'arc, des étoiles marquent
//    la course.
//
//  Même appel que le potard commun :
//      onirique::ui::drawKnobViseur (g, zone, position, angleDebut, angleFin, accent, bipolaire, survolé);
//      onirique::ui::drawKnobNova   (g, zone, position, angleDebut, angleFin, accent, bipolaire, survolé);
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
} // namespace logoknob

/** « Viseur » : la croix de visée du logo. */
inline void drawKnobViseur (juce::Graphics& g, juce::Rectangle<float> area, float position, float startAngle, float endAngle,
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

} // namespace onirique::ui

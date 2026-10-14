//==============================================================================
//  onirique-probe : fabrique la démo interactive d'un plugin à partir de son .vst3.
//
//      onirique-probe <plugin.vst3> <dossier de sortie> [images par réglage, 12 par défaut]
//
//  Le plugin est chargé comme dans un DAW et son interface ouverte. Chaque
//  réglage est ensuite balayé de son minimum à son maximum : la zone de
//  l'écran qui change est celle du bouton, et son aspect à chaque position est
//  enregistré. Le site rejoue ces images quand on tourne le bouton.
//
//  Sorties : base.png (l'interface au repos) et demo.json (tout le nécessaire,
//  images comprises). Aucun son n'est traité.
//==============================================================================
#include <juce_audio_processors/juce_audio_processors.h>

#include <iostream>
#include <windows.h>

namespace
{

void pump (int milliseconds)
{
    juce::MessageManager::getInstance()->runDispatchLoopUntil (milliseconds);
}

/** Photographie le contenu d'une fenêtre, vues enfants comprises (l'interface d'un VST3 en est une). */
juce::Image capture (HWND window)
{
    RECT client {};
    GetClientRect (window, &client);
    const int width = client.right, height = client.bottom;
    if (width <= 0 || height <= 0)
        return {};

    HDC windowDc = GetDC (window);
    HDC memoryDc = CreateCompatibleDC (windowDc);

    BITMAPINFO info {};
    info.bmiHeader.biSize = sizeof (BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height; // de haut en bas
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;

    void* bits = nullptr;
    HBITMAP bitmap = CreateDIBSection (windowDc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    HGDIOBJ previous = SelectObject (memoryDc, bitmap);

    const UINT renderFullContent = 0x00000002; // PW_RENDERFULLCONTENT : indispensable pour un rendu Direct2D
    static bool readScreen = false; // décidé à la première capture, puis gardé : les images doivent rester comparables
    auto uniform = [&]
    {
        const auto* pixels = static_cast<const juce::uint32*> (bits);
        for (int i = 0; i < width * height; i += 5)
            if ((pixels[i] & 0x00ffffff) != (pixels[0] & 0x00ffffff))
                return false;
        return true;
    };

    if (! readScreen)
    {
        PrintWindow (window, memoryDc, PW_CLIENTONLY | renderFullContent);
        GdiFlush();
        readScreen = uniform();
    }

    if (readScreen)
    {
        POINT origin { 0, 0 };
        ClientToScreen (window, &origin);
        HDC screenDc = GetDC (nullptr);
        BitBlt (memoryDc, 0, 0, width, height, screenDc, origin.x, origin.y, SRCCOPY);
        ReleaseDC (nullptr, screenDc);
        GdiFlush();
    }

    juce::Image image (juce::Image::RGB, width, height, false);
    {
        juce::Image::BitmapData data (image, juce::Image::BitmapData::writeOnly);
        const auto* source = static_cast<const juce::uint8*> (bits);
        for (int y = 0; y < height; ++y)
        {
            auto* line = data.getLinePointer (y);
            const auto* row = source + (size_t) y * (size_t) width * 4;
            for (int x = 0; x < width; ++x) // BGRA -> BGR, l'ordre en mémoire des deux côtés
                std::memcpy (line + x * data.pixelStride, row + x * 4, 3);
        }
    }

    SelectObject (memoryDc, previous);
    DeleteObject (bitmap);
    DeleteDC (memoryDc);
    ReleaseDC (window, windowDc);
    return image;
}

/** Vrai si le pixel diffère nettement entre les deux images. */
inline bool differs (const juce::uint8* a, const juce::uint8* b)
{
    return std::abs (a[0] - b[0]) > 14 || std::abs (a[1] - b[1]) > 14 || std::abs (a[2] - b[2]) > 14;
}

/** Marque dans `mask` les pixels qui changent entre deux images. */
void markChanges (const juce::Image& a, const juce::Image& b, std::vector<char>& mask)
{
    const juce::Image::BitmapData da (a, juce::Image::BitmapData::readOnly), db (b, juce::Image::BitmapData::readOnly);
    for (int y = 0; y < da.height; ++y)
        for (int x = 0; x < da.width; ++x)
            if (differs (da.getPixelPointer (x, y), db.getPixelPointer (x, y)))
                mask[(size_t) y * (size_t) da.width + (size_t) x] = 1;
}

/** Élargit un masque d'un pixel dans toutes les directions, `radius` fois. */
void dilate (std::vector<char>& mask, int width, int height, int radius)
{
    for (int pass = 0; pass < radius; ++pass)
    {
        const auto source = mask;
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x)
                if (! source[(size_t) y * (size_t) width + (size_t) x])
                    for (int dy = -1; dy <= 1; ++dy)
                        for (int dx = -1; dx <= 1; ++dx)
                        {
                            const int nx = x + dx, ny = y + dy;
                            if (nx >= 0 && ny >= 0 && nx < width && ny < height && source[(size_t) ny * (size_t) width + (size_t) nx])
                                mask[(size_t) y * (size_t) width + (size_t) x] = 1;
                        }
    }
}

/** Découpe un masque de pixels en îlots (le bouton, son afficheur de valeur, un écran lié...) et rend leurs rectangles. */
std::vector<juce::Rectangle<int>> islands (const std::vector<char>& changed, int width, int height)
{
    const int cell = 6; // deux zones séparées de moins de deux cellules sont réunies
    const int gw = (width + cell - 1) / cell, gh = (height + cell - 1) / cell;
    std::vector<char> grid ((size_t) gw * (size_t) gh, 0);
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x)
            if (changed[(size_t) y * (size_t) width + (size_t) x])
                grid[(size_t) (y / cell) * (size_t) gw + (size_t) (x / cell)] = 1;

    auto joined = grid;
    dilate (joined, gw, gh, 1);

    std::vector<int> label ((size_t) gw * (size_t) gh, -1);
    std::vector<juce::Rectangle<int>> result;
    for (int sy = 0; sy < gh; ++sy)
        for (int sx = 0; sx < gw; ++sx)
        {
            const auto seed = (size_t) sy * (size_t) gw + (size_t) sx;
            if (! joined[seed] || label[seed] >= 0)
                continue;

            int left = gw, top = gh, right = -1, bottom = -1;
            std::vector<std::pair<int, int>> stack { { sx, sy } };
            label[seed] = (int) result.size();
            while (! stack.empty())
            {
                const auto [x, y] = stack.back();
                stack.pop_back();
                if (grid[(size_t) y * (size_t) gw + (size_t) x])
                {
                    left = std::min (left, x);  right = std::max (right, x);
                    top = std::min (top, y);    bottom = std::max (bottom, y);
                }
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx)
                    {
                        const int nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh)
                            continue;
                        const auto next = (size_t) ny * (size_t) gw + (size_t) nx;
                        if (joined[next] && label[next] < 0)
                        {
                            label[next] = (int) result.size();
                            stack.push_back ({ nx, ny });
                        }
                    }
            }

            if (right >= 0)
                result.push_back (juce::Rectangle<int> (left * cell, top * cell, (right - left + 1) * cell, (bottom - top + 1) * cell)
                                      .expanded (1).getIntersection ({ 0, 0, width, height }));
            else
                result.push_back ({});
        }

    result.erase (std::remove_if (result.begin(), result.end(), [] (const auto& r) { return r.getWidth() * r.getHeight() < 60; }), result.end());
    return result;
}

/** Une image en JPEG : pour les images entières de l'interface, qu'un PNG rendrait trop lourdes. */
juce::String toJpegDataUrl (const juce::Image& image)
{
    juce::MemoryOutputStream jpeg;
    juce::JPEGImageFormat format;
    format.setQuality (0.84f);
    format.writeImageToStream (image, jpeg);
    return "data:image/jpeg;base64," + juce::Base64::toBase64 (jpeg.getData(), jpeg.getDataSize());
}

juce::String toDataUrl (const juce::Image& image)
{
    juce::MemoryOutputStream png;
    juce::PNGImageFormat().writeImageToStream (image, png);
    return "data:image/png;base64," + juce::Base64::toBase64 (png.getData(), png.getDataSize());
}

/** Termine le programme tout de suite, sorties écrites. */
[[noreturn]] void finish (int code)
{
    std::cout.flush();
    TerminateProcess (GetCurrentProcess(), (UINT) code);
    std::abort(); // jamais atteint
}

void restoreDefaults (juce::AudioPluginInstance& plugin)
{
    for (auto* parameter : plugin.getParameters())
        if (std::abs (parameter->getValue() - parameter->getDefaultValue()) > 1.0e-6f)
            parameter->setValueNotifyingHost (parameter->getDefaultValue());
}

} // namespace

//==============================================================================
int main (int argc, char** argv)
{
    if (argc < 3)
    {
        std::cout << "usage : onirique-probe <plugin.vst3> <dossier de sortie> [images par reglage]" << std::endl;
        return 2;
    }

    const juce::File pluginFile (juce::File::getCurrentWorkingDirectory().getChildFile (juce::String::fromUTF8 (argv[1])));
    const juce::File outDir (juce::File::getCurrentWorkingDirectory().getChildFile (juce::String::fromUTF8 (argv[2])));
    const int framesPerKnob = juce::jlimit (4, 32, argc > 3 ? std::atoi (argv[3]) : 12);
    const int settleMs = 140; // le temps qu'un plugin redessine après un changement de réglage

    juce::ScopedJuceInitialiser_GUI gui;

    juce::VST3PluginFormat format;
    juce::OwnedArray<juce::PluginDescription> found;
    format.findAllTypesForFile (found, pluginFile.getFullPathName());
    if (found.isEmpty())
    {
        std::cout << "ERREUR aucun plugin VST3 dans ce fichier" << std::endl;
        finish (1);
    }

    juce::String error;
    std::unique_ptr<juce::AudioPluginInstance> plugin (format.createInstanceFromDescription (*found[0], 48000.0, 512, error));
    if (plugin == nullptr)
    {
        std::cout << "ERREUR chargement impossible : " << error << std::endl;
        finish (1);
    }

    plugin->setPlayConfigDetails (2, 2, 48000.0, 512);
    plugin->prepareToPlay (48000.0, 512);

    std::unique_ptr<juce::AudioProcessorEditor> editor (plugin->createEditorIfNeeded());
    if (editor == nullptr)
    {
        std::cout << "ERREUR ce plugin n'a pas d'interface" << std::endl;
        finish (1);
    }

    editor->setOpaque (true);
    editor->addToDesktop (0);
    editor->setTopLeftPosition (60, 60);
    editor->setVisible (true);
    pump (900);

    auto* peer = editor->getPeer();
    HWND window = peer != nullptr ? (HWND) peer->getNativeHandle() : nullptr;
    if (window == nullptr)
    {
        std::cout << "ERREUR fenetre de l'interface introuvable" << std::endl;
        finish (1);
    }

    // L'interface au repos, et ce qui bouge tout seul (vumètres, animations) pour ne pas le confondre avec un bouton.
    restoreDefaults (*plugin);
    pump (400);
    const juce::Image base = capture (window);
    if (! base.isValid())
    {
        std::cout << "ERREUR capture de l'interface impossible" << std::endl;
        finish (1);
    }

    const int width = base.getWidth(), height = base.getHeight();
    std::vector<char> noisy ((size_t) width * (size_t) height, 0);
    for (int i = 0; i < 30; ++i)
    {
        pump (200);
        markChanges (base, capture (window), noisy);
    }
    dilate (noisy, width, height, 3);

    // Un écran animé (réticule qui tourne, étincelles) ne passe pas partout en six secondes : chaque îlot
    // animé est donc rempli en entier, sauf s'il couvrait une grande part de l'interface.
    for (const auto& zone : islands (noisy, width, height))
        if ((double) zone.getWidth() * (double) zone.getHeight() < 0.3 * (double) width * (double) height)
            for (int y = zone.getY(); y < zone.getBottom(); ++y)
                for (int x = zone.getX(); x < zone.getRight(); ++x)
                    noisy[(size_t) y * (size_t) width + (size_t) x] = 1;

    {
        juce::Image::BitmapData data (base, juce::Image::BitmapData::readOnly);
        bool blank = true;
        const auto* first = data.getPixelPointer (0, 0);
        for (int y = 0; y < height && blank; y += 7)
            for (int x = 0; x < width && blank; x += 7)
                blank = ! differs (first, data.getPixelPointer (x, y));
        if (blank)
        {
            std::cout << "ERREUR l'interface capturee est vide" << std::endl;
            finish (1);
        }
    }

    juce::Array<juce::var> controls;
    juce::StringArray hidden, tooWide, whole;
    const auto& parameters = plugin->getParameters();
    const double screenArea = (double) width * (double) height;

    for (int index = 0; index < parameters.size(); ++index)
    {
        auto* parameter = parameters[index];
        const juce::String name = parameter->getName (64);
        std::cout << "PROGRESSION " << (index + 1) << "/" << parameters.size() << " " << name << std::endl;

        if (! parameter->isAutomatable() || parameter == plugin->getBypassParameter())
            continue;

        const bool discrete = parameter->isDiscrete() && parameter->getNumSteps() >= 2 && parameter->getNumSteps() <= 24;
        const int count = discrete ? parameter->getNumSteps() : framesPerKnob;
        auto valueAt = [count] (int k) { return (float) k / (float) (count - 1); };

        auto shoot = [&] (int k)
        {
            parameter->setValueNotifyingHost (valueAt (k));
            pump (settleMs);
            return capture (window);
        };

        // Trois positions d'abord : si rien ne bouge, ce réglage n'a pas de bouton à l'écran.
        std::vector<juce::Image> frames ((size_t) count);
        std::vector<char> changed ((size_t) width * (size_t) height, 0);
        for (int k : { 0, count - 1, count / 2 })
            if (! frames[(size_t) k].isValid())
            {
                frames[(size_t) k] = shoot (k);
                markChanges (base, frames[(size_t) k], changed);
            }

        auto anyChange = [&]
        {
            for (size_t i = 0; i < changed.size(); ++i)
                if (changed[i] && ! noisy[i])
                    return true;
            return false;
        };

        const bool visible = anyChange();
        if (visible)
            for (int k = 0; k < count; ++k)
                if (! frames[(size_t) k].isValid())
                {
                    frames[(size_t) k] = shoot (k);
                    markChanges (base, frames[(size_t) k], changed);
                }

        juce::StringArray texts;
        for (int k = 0; k < count; ++k)
            texts.add ((parameter->getText (valueAt (k), 64) + " " + parameter->getLabel()).trim());

        // Retour au repos. Ce qui diffère encore de l'image de départ bouge tout seul : on l'ajoute aux zones animées.
        restoreDefaults (*plugin);
        pump (settleMs + 60);
        {
            std::vector<char> drift ((size_t) width * (size_t) height, 0);
            markChanges (base, capture (window), drift);
            dilate (drift, width, height, 3);
            for (size_t i = 0; i < drift.size(); ++i)
                noisy[i] = (char) (noisy[i] | drift[i]);
        }

        // Ce qui a changé dans les zones animées (l'écran d'un personnage, un vumètre) ne peut pas être découpé :
        // un réglage qui y change beaucoup (une couleur qui repeint tout le plugin) est gardé en images entières.
        double clean = 0.0, inAnimated = 0.0;
        for (size_t i = 0; i < changed.size(); ++i)
        {
            if (! changed[i])
                continue;
            if (noisy[i]) { inAnimated += 1.0; changed[i] = 0; }
            else clean += 1.0;
        }

        const auto areas = visible ? islands (changed, width, height) : std::vector<juce::Rectangle<int>>();
        if (areas.empty())
        {
            hidden.add (name);
            continue;
        }

        const int defaultIndex = juce::jlimit (0, count - 1, juce::roundToInt (parameter->getDefaultValue() * (float) (count - 1)));

        // Un réglage qui redessine une grande partie de l'interface (couleur, mode, page) ne se rejoue pas par
        // morceaux : ses positions sont gardées en images entières, et le site le propose sous l'interface, comme
        // un sélecteur. Quatre au plus, et pas plus de douze positions chacun (six pour un bouton continu).
        double total = 0.0;
        for (const auto& area : areas)
            total += (double) area.getWidth() * (double) area.getHeight();
        const bool global = total > 0.45 * screenArea || areas.size() > 12 || (inAnimated > 2000.0 && inAnimated > 0.5 * clean);
        if (global)
        {
            if (whole.size() >= 4 || (discrete && count > 12))
            {
                tooWide.add (name);
                continue;
            }
            std::vector<int> picks;
            if (discrete)
                for (int k = 0; k < count; ++k) picks.push_back (k);
            else
                for (int k = 0; k < 6; ++k) picks.push_back (juce::roundToInt ((double) k * (count - 1) / 5.0));

            juce::Image strip (juce::Image::RGB, width, height * (int) picks.size(), false);
            juce::StringArray pickedTexts;
            int start = 0;
            {
                juce::Graphics g (strip);
                for (size_t i = 0; i < picks.size(); ++i)
                {
                    g.drawImageAt (frames[(size_t) picks[i]], 0, (int) i * height);
                    pickedTexts.add (texts[picks[i]]);
                    if (std::abs (picks[i] - defaultIndex) < std::abs (picks[(size_t) start] - defaultIndex))
                        start = (int) i;
                }
            }
            auto* part = new juce::DynamicObject();
            part->setProperty ("x", 0.0);
            part->setProperty ("y", 0.0);
            part->setProperty ("w", 1.0);
            part->setProperty ("h", 1.0);
            part->setProperty ("sprite", toJpegDataUrl (strip));
            juce::Array<juce::var> parts;
            parts.add (juce::var (part));

            auto* control = new juce::DynamicObject();
            control->setProperty ("name", name);
            control->setProperty ("frames", (int) picks.size());
            control->setProperty ("discrete", true);
            control->setProperty ("global", true);
            control->setProperty ("start", start);
            control->setProperty ("texts", juce::var (pickedTexts));
            control->setProperty ("parts", juce::var (parts));
            controls.add (juce::var (control));
            whole.add (name);
            continue;
        }

        juce::Array<juce::var> parts;
        for (const auto& area : areas)
        {
            juce::Image strip (juce::Image::RGB, area.getWidth(), area.getHeight() * count, false);
            {
                juce::Graphics g (strip);
                for (int k = 0; k < count; ++k)
                    g.drawImageAt (frames[(size_t) k].getClippedImage (area), 0, k * area.getHeight());
            }

            auto* part = new juce::DynamicObject();
            part->setProperty ("x", (double) area.getX() / width);
            part->setProperty ("y", (double) area.getY() / height);
            part->setProperty ("w", (double) area.getWidth() / width);
            part->setProperty ("h", (double) area.getHeight() / height);
            part->setProperty ("sprite", toDataUrl (strip));
            parts.add (juce::var (part));
        }

        auto* control = new juce::DynamicObject();
        control->setProperty ("name", name);
        control->setProperty ("frames", count);
        control->setProperty ("discrete", discrete);
        control->setProperty ("start", defaultIndex);
        control->setProperty ("texts", juce::var (texts));
        control->setProperty ("parts", juce::var (parts));
        controls.add (juce::var (control));
    }

    outDir.createDirectory();

    juce::FileOutputStream basePng (outDir.getChildFile ("base.png"));
    basePng.setPosition (0);
    basePng.truncate();
    juce::PNGImageFormat().writeImageToStream (base, basePng);
    basePng.flush(); // finish() arrête le processus sans passer par les destructeurs : sans ceci, la fin de l'image est perdue

    auto* demo = new juce::DynamicObject();
    demo->setProperty ("format", "onirique-demo-v1");
    demo->setProperty ("plugin", found[0]->name);
    demo->setProperty ("pluginVersion", found[0]->version);
    demo->setProperty ("width", width);
    demo->setProperty ("height", height);
    demo->setProperty ("base", toDataUrl (base));
    demo->setProperty ("controls", juce::var (controls));
    outDir.getChildFile ("demo.json").replaceWithText (juce::JSON::toString (juce::var (demo), true));

    std::cout << "RESULTAT " << controls.size() << " boutons enregistres, " << hidden.size() << " reglages sans bouton visible, "
              << whole.size() << " en images entieres, " << tooWide.size() << " ecartes, image " << width << "x" << height << std::endl;
    if (! hidden.isEmpty())  std::cout << "  sans bouton : " << hidden.joinIntoString (", ") << std::endl;
    if (! whole.isEmpty())   std::cout << "  images entieres : " << whole.joinIntoString (", ") << std::endl;
    if (! tooWide.isEmpty()) std::cout << "  ecartes : " << tooWide.joinIntoString (", ") << std::endl;

    finish (0);
}

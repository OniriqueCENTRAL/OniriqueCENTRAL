//==============================================================================
//  onirique-film : filme l'interface d'un plugin pendant qu'une souris s'en sert,
//  pour les vidéos des fiches de la boutique (site/assets/videos/).
//
//      onirique-film <plugin.vst3> <scenario.json> <dossier des images>
//
//  Le plugin est chargé comme dans un DAW, joue en boucle le son du scénario
//  (lecture au tempo, tête de lecture qui avance) et son interface s'ouvre sur
//  l'écran secondaire sans prendre le focus. Les gestes du scénario sont envoyés
//  à la fenêtre comme de vrais messages de souris, sans bouger la souris de la
//  personne ; la flèche est dessinée sur chaque image. 30 images par seconde,
//  en JPEG, à assembler ensuite avec ffmpeg.
//
//  Scénario (JSON) :
//    { "audio": "voix.wav", "bpm": 140, "scale": 1.5, "x": -1650, "y": 60,
//      "params": { "Nom du réglage": 0.5 }, "start": [x, y],
//      "steps": [ { "wait": 1 }, { "move": [x, y], "t": 0.6 }, { "down": 1 },
//                 { "up": 1 }, { "click": 1 }, { "wheel": -120 },
//                 { "param": "Nom", "to": 0.8, "t": 1 }, { "play": false },
//                 { "seek": 12.5 } ] }   (seek : la tête de lecture du DAW, en secondes)
//  Les coordonnées sont en pixels de l'image filmée ; sans "steps", une seule
//  image (pour relever les coordonnées).
//==============================================================================
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <iostream>
#include <map>
#include <thread>
#include <windows.h>

namespace
{

void pump (int milliseconds)
{
    juce::MessageManager::getInstance()->runDispatchLoopUntil (juce::jmax (1, milliseconds));
}

//==============================================================================
/** La tête de lecture d'un DAW qui joue : tempo fixe, position qui avance. */
struct Head : juce::AudioPlayHead
{
    double bpm = 120.0, rate = 48000.0;
    std::atomic<bool> playing { true };
    std::atomic<juce::int64> samples { 0 };

    juce::Optional<PositionInfo> getPosition() const override
    {
        PositionInfo info;
        const auto s = samples.load();
        const double seconds = (double) s / rate, beats = seconds * bpm / 60.0;
        info.setBpm (bpm);
        info.setTimeSignature (TimeSignature { 4, 4 });
        info.setTimeInSamples (s);
        info.setTimeInSeconds (seconds);
        info.setPpqPosition (beats);
        info.setPpqPositionOfLastBarStart (std::floor (beats / 4.0) * 4.0);
        info.setIsPlaying (playing.load());
        return info;
    }
};

/** Fait jouer le plugin en temps réel, son en boucle, sans carte son : le DAW qu'il croit avoir. */
struct Player
{
    juce::AudioPluginInstance& plugin;
    juce::AudioBuffer<float> source;
    Head& head;
    std::atomic<bool> running { true };
    std::thread thread;
    static constexpr int block = 512;

    Player (juce::AudioPluginInstance& p, juce::AudioBuffer<float> s, Head& h) : plugin (p), source (std::move (s)), head (h)
    {
        thread = std::thread ([this] { run(); });
    }

    ~Player()
    {
        running = false;
        thread.join();
    }

    void run()
    {
        const int ins = juce::jmax (2, plugin.getTotalNumInputChannels()), outs = juce::jmax (2, plugin.getTotalNumOutputChannels());
        juce::AudioBuffer<float> buffer (juce::jmax (ins, outs), block);
        juce::MidiBuffer midi;
        juce::int64 read = 0;
        const auto period = std::chrono::duration<double> (block / head.rate);
        auto next = std::chrono::steady_clock::now();
        while (running)
        {
            buffer.clear();
            if (head.playing && source.getNumSamples() > 0)
            {
                for (int i = 0; i < block; ++i, ++read)
                    for (int c = 0; c < 2; ++c)
                        buffer.setSample (c, i, source.getSample (juce::jmin (c, source.getNumChannels() - 1), (int) (read % source.getNumSamples())));
            }
            midi.clear();
            plugin.processBlock (buffer, midi);
            if (head.playing)
                head.samples += block;

            next += std::chrono::duration_cast<std::chrono::steady_clock::duration> (period);
            std::this_thread::sleep_until (next);
        }
    }
};

//==============================================================================
// Les fenêtres du plugin ne doivent pas croire que la souris les a quittées : la vraie souris est ailleurs,
// et Windows enverrait WM_MOUSELEAVE à chaque geste (le survol et les glisser seraient perdus).
std::map<HWND, WNDPROC> originalProcs;

LRESULT CALLBACK keepMouseInside (HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_MOUSELEAVE || message == WM_NCMOUSELEAVE)
        return 0;
    return CallWindowProc (originalProcs[window], window, message, wParam, lParam);
}

void holdMouse (HWND window)
{
    if (window != nullptr && originalProcs.find (window) == originalProcs.end())
        originalProcs[window] = (WNDPROC) SetWindowLongPtr (window, GWLP_WNDPROC, (LONG_PTR) keepMouseInside);
}

/** La fenêtre la plus profonde sous un point (en coordonnées de `root`), et ce point dans ses coordonnées. */
HWND deepest (HWND root, POINT& point)
{
    HWND current = root;
    for (;;)
    {
        HWND child = ChildWindowFromPointEx (current, point, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT);
        if (child == nullptr || child == current)
            return current;
        MapWindowPoints (current, child, &point, 1);
        current = child;
    }
}

/** Une souris qui n'existe que pour la fenêtre filmée. */
struct Mouse
{
    HWND root;
    float scale; // pixels de l'image par pixel de fenêtre (1 : l'image est la fenêtre)
    juce::Point<float> at;
    bool down = false;
    HWND captured = nullptr;

    void send (UINT message, WPARAM extra = 0)
    {
        POINT p { (LONG) std::lround (at.x / scale), (LONG) std::lround (at.y / scale) };
        HWND target = captured;
        if (target != nullptr)
            MapWindowPoints (root, target, &p, 1);
        else
            target = deepest (root, p);
        holdMouse (target);
        const WPARAM buttons = (down ? MK_LBUTTON : 0) | extra;
        if (message == WM_MOUSEWHEEL)
        {
            POINT screen = p;
            ClientToScreen (target, &screen);
            SendMessage (target, message, MAKEWPARAM (buttons, (WORD) (short) extra), MAKELPARAM (screen.x, screen.y));
            return;
        }
        if (message == WM_LBUTTONDOWN)
            captured = target;
        SendMessage (target, message, buttons, MAKELPARAM (p.x, p.y));
        if (message == WM_LBUTTONUP)
            captured = nullptr;
    }

    void moveTo (juce::Point<float> p) { at = p; send (WM_MOUSEMOVE); }
    void press()   { down = true;  send (WM_LBUTTONDOWN); }
    void release() { down = false; send (WM_LBUTTONUP); send (WM_MOUSEMOVE); }
};

//==============================================================================
/** L'image de la fenêtre, flèche de la souris comprise. */
juce::Image capture (HWND window, juce::Point<float> cursor, bool showCursor, bool fromScreen = false)
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
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HBITMAP bitmap = CreateDIBSection (windowDc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    HGDIOBJ previous = SelectObject (memoryDc, bitmap);

    if (fromScreen) // ce que l'écran montre : une vidéo jouée par le GPU (WebView2) n'apparaît pas autrement
    {
        POINT origin { 0, 0 };
        ClientToScreen (window, &origin);
        HDC screenDc = GetDC (nullptr);
        BitBlt (memoryDc, 0, 0, width, height, screenDc, origin.x, origin.y, SRCCOPY);
        ReleaseDC (nullptr, screenDc);
    }
    else
        PrintWindow (window, memoryDc, PW_CLIENTONLY | 0x00000002 /* PW_RENDERFULLCONTENT */);
    GdiFlush();

    if (showCursor)
    {
        static HCURSOR arrow = LoadCursor (nullptr, IDC_ARROW);
        static POINT hotspot = [] { ICONINFO i {}; GetIconInfo (arrow, &i); DeleteObject (i.hbmMask); DeleteObject (i.hbmColor); return POINT { (LONG) i.xHotspot, (LONG) i.yHotspot }; }();
        DrawIconEx (memoryDc, (int) cursor.x - hotspot.x, (int) cursor.y - hotspot.y, arrow, 0, 0, 0, nullptr, DI_NORMAL | DI_DEFAULTSIZE);
        GdiFlush();
    }

    juce::Image image (juce::Image::RGB, width, height, false);
    {
        juce::Image::BitmapData data (image, juce::Image::BitmapData::writeOnly);
        const auto* source = static_cast<const juce::uint8*> (bits);
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x)
                std::memcpy (data.getPixelPointer (x, y), source + ((size_t) y * (size_t) width + (size_t) x) * 4, 3);
    }
    SelectObject (memoryDc, previous);
    DeleteObject (bitmap);
    DeleteDC (memoryDc);
    ReleaseDC (window, windowDc);
    return image;
}

juce::AudioProcessorParameter* findParameter (juce::AudioPluginInstance& plugin, const juce::String& name)
{
    for (auto* p : plugin.getParameters())
        if (p->getName (100).equalsIgnoreCase (name))
            return p;
    std::cout << "ATTENTION reglage inconnu : " << name << std::endl;
    return nullptr;
}

float ease (float t) { t = juce::jlimit (0.0f, 1.0f, t); return t * t * (3.0f - 2.0f * t); }

} // namespace

//==============================================================================
int main (int argc, char** argv)
{
    if (argc < 4)
    {
        std::cout << "usage : onirique-film <plugin.vst3> <scenario.json> <dossier des images>" << std::endl;
        return 2;
    }
    const auto cwd = juce::File::getCurrentWorkingDirectory();
    const juce::File pluginFile (cwd.getChildFile (juce::String::fromUTF8 (argv[1])));
    const juce::File scenarioFile (cwd.getChildFile (juce::String::fromUTF8 (argv[2])));
    const juce::File outDir (cwd.getChildFile (juce::String::fromUTF8 (argv[3])));

    juce::ScopedJuceInitialiser_GUI gui;
    const auto scenario = juce::JSON::parse (scenarioFile);
    if (! scenario.isObject())
    {
        std::cout << "ERREUR scenario illisible" << std::endl;
        return 1;
    }

    // Le son à faire jouer, à sa propre fréquence.
    juce::AudioBuffer<float> source;
    double rate = 48000.0;
    if (scenario["audio"].toString().isNotEmpty())
    {
        juce::AudioFormatManager formats;
        formats.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader (formats.createReaderFor (scenarioFile.getParentDirectory().getChildFile (scenario["audio"].toString())));
        if (reader == nullptr)
        {
            std::cout << "ERREUR son illisible" << std::endl;
            return 1;
        }
        rate = reader->sampleRate;
        source.setSize ((int) reader->numChannels, (int) reader->lengthInSamples);
        reader->read (&source, 0, (int) reader->lengthInSamples, 0, true, true);
        source.applyGain ((float) (double) scenario.getProperty ("gain", 1.0));
    }

    juce::VST3PluginFormat format;
    juce::OwnedArray<juce::PluginDescription> found;
    format.findAllTypesForFile (found, pluginFile.getFullPathName());
    juce::String error;
    std::unique_ptr<juce::AudioPluginInstance> plugin (found.isEmpty() ? nullptr : format.createInstanceFromDescription (*found[0], rate, Player::block, error));
    if (plugin == nullptr)
    {
        std::cout << "ERREUR chargement impossible : " << error << std::endl;
        return 1;
    }

    Head head;
    head.rate = rate;
    head.bpm = (double) scenario.getProperty ("bpm", 140.0);
    head.playing = (bool) scenario.getProperty ("playing", true);
    plugin->setPlayHead (&head);
    plugin->setPlayConfigDetails (2, 2, rate, Player::block);
    plugin->prepareToPlay (rate, Player::block);

    // "state" : l'état XML que le plugin enregistre dans un projet (une vidéo déjà choisie...), rendu tel que le DAW le lui rendrait.
    if (auto own = juce::parseXML (scenario["state"].toString()))
    {
        juce::MemoryBlock inner, outer;
        juce::AudioProcessor::copyXmlToBinary (*own, inner);
        juce::XmlElement wrapped ("VST3PluginState");
        wrapped.createNewChildElement ("IComponent")->addTextElement (inner.toBase64Encoding());
        juce::AudioProcessor::copyXmlToBinary (wrapped, outer);
        plugin->setStateInformation (outer.getData(), (int) outer.getSize());
    }

    if (auto* params = scenario["params"].getDynamicObject())
        for (auto& p : params->getProperties())
            if (auto* parameter = findParameter (*plugin, p.name.toString()))
                parameter->setValueNotifyingHost ((float) (double) p.value);

    std::unique_ptr<juce::AudioProcessorEditor> editor (plugin->createEditorIfNeeded());
    if (editor == nullptr)
    {
        std::cout << "ERREUR ce plugin n'a pas d'interface" << std::endl;
        return 1;
    }
    const float scale = (float) (double) scenario.getProperty ("scale", 1.0);
    editor->setScaleFactor (scale);
    if (scenario["size"].isArray())
        editor->setSize ((int) scenario["size"][0], (int) scenario["size"][1]);
    editor->setOpaque (true);
    editor->addToDesktop (0);

    auto* peer = editor->getPeer();
    HWND window = peer != nullptr ? (HWND) peer->getNativeHandle() : nullptr;
    if (window == nullptr)
    {
        std::cout << "ERREUR fenetre de l'interface introuvable" << std::endl;
        return 1;
    }
    // Sur l'écran secondaire, sans voler le focus de la personne.
    SetWindowLongPtr (window, GWL_EXSTYLE, GetWindowLongPtr (window, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
    SetWindowPos (window, nullptr, (int) scenario.getProperty ("x", -1650), (int) scenario.getProperty ("y", 60), 0, 0,
                  SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    editor->setVisible (true);
    ShowWindow (window, SW_SHOWNA);

    Player player (*plugin, std::move (source), head);
    pump ((int) (1000.0 * (double) scenario.getProperty ("warmup", 1.5)));

    RECT client {};
    GetClientRect (window, &client);
    Mouse mouse { window, 1.0f };
    if (scenario["start"].isArray())
        mouse.at = { (float) (double) scenario["start"][0], (float) (double) scenario["start"][1] };
    else
        mouse.at = { client.right * 0.5f, client.bottom * 0.5f };

    outDir.createDirectory();
    for (auto& f : outDir.findChildFiles (juce::File::findFiles, false, "f*.jpg"))
        f.deleteFile();

    const auto* steps = scenario["steps"].getArray();
    if (steps == nullptr || steps->isEmpty())
    {
        juce::FileOutputStream out (outDir.getChildFile ("base.png"));
        out.setPosition (0); out.truncate();
        juce::PNGImageFormat().writeImageToStream (capture (window, mouse.at, false), out);
        for (auto* p : plugin->getParameters()) // les noms à utiliser dans "params" et "param"
            std::cout << p->getName (100) << " = " << p->getValue() << " (" << p->getCurrentValueAsText() << ")" << std::endl;
        std::cout << "OK " << client.right << "x" << client.bottom << std::endl;
        return 0;
    }

    // Les images sont écrites par un fil à part pour tenir les 30 images par seconde.
    juce::ThreadPool writers (2);
    const double fps = 30.0;
    const double tail = (double) scenario.getProperty ("tail", 0.6);
    const bool showCursor = (bool) scenario.getProperty ("cursor", true);
    const bool fromScreen = (bool) scenario.getProperty ("screen", false);
    if (fromScreen) // au-dessus des autres fenêtres de l'écran secondaire, toujours sans prendre le focus
        SetWindowPos (window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    int index = 0;
    double stepStart = 0.0;
    juce::Point<float> from = mouse.at;
    float paramFrom = 0.0f;
    bool stepBegun = false;
    double endAt = -1.0;

    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    for (int frame = 0;; ++frame)
    {
        const double now = frame / fps;

        // Les gestes du scénario jusqu'à cet instant.
        while (index < steps->size())
        {
            const auto& s = steps->getReference (index);
            const double length = (double) s.getProperty ("t", s.hasProperty ("wait") ? (double) s["wait"] : 0.0);
            if (! stepBegun)
            {
                stepBegun = true;
                from = mouse.at;
                if (s.hasProperty ("param"))
                    if (auto* p = findParameter (*plugin, s["param"].toString())) { paramFrom = p->getValue(); p->beginChangeGesture(); }
                if (s.hasProperty ("down"))  mouse.press();
                if (s.hasProperty ("up"))    mouse.release();
                if (s.hasProperty ("click")) { mouse.press(); pump (60); mouse.release(); }
                if (s.hasProperty ("wheel")) mouse.send (WM_MOUSEWHEEL, (WPARAM) (int) s["wheel"]);
                if (s.hasProperty ("play"))  head.playing = (bool) s["play"];
                if (s.hasProperty ("seek"))  head.samples = (juce::int64) ((double) s["seek"] * head.rate);
            }
            const float k = length > 0.0 ? ease ((float) ((now - stepStart) / length)) : 1.0f;
            if (s["move"].isArray())
                mouse.moveTo (from + (juce::Point<float> ((float) (double) s["move"][0], (float) (double) s["move"][1]) - from) * k);
            if (s.hasProperty ("param"))
                if (auto* p = findParameter (*plugin, s["param"].toString()))
                {
                    p->setValueNotifyingHost (paramFrom + ((float) (double) s["to"] - paramFrom) * k);
                    if (k >= 1.0f) p->endChangeGesture();
                }
            if (now - stepStart < length)
                break;
            ++index;
            stepStart += length;
            stepBegun = false;
        }
        if (index >= steps->size() && endAt < 0.0)
            endAt = now + tail;
        if (endAt >= 0.0 && now >= endAt)
            break;

        const double due = t0 + 1000.0 * now;
        pump ((int) (due - juce::Time::getMillisecondCounterHiRes()));
        auto image = capture (window, mouse.at, showCursor, fromScreen);
        const auto file = outDir.getChildFile (juce::String::formatted ("f%05d.jpg", frame));
        writers.addJob ([image, file]
        {
            juce::FileOutputStream out (file);
            juce::JPEGImageFormat jpeg;
            jpeg.setQuality (0.95f);
            jpeg.writeImageToStream (image, out);
        });
    }
    while (writers.getNumJobs() > 0)
        juce::Thread::sleep (20);
    std::cout << "OK " << client.right << "x" << client.bottom << std::endl;
    return 0;
}
